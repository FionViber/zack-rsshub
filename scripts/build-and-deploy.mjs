import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const automationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = path.join(automationRoot, 'templates');
const statePath = path.join(automationRoot, 'state', 'upstream-sha.json');
const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'RSSHUB_CACHE_KV_ID', 'RSSHUB_ACCESS_KEY', 'RSSHUB_TEST_BASE_URL'];
const secretNames = new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'RSSHUB_CACHE_KV_ID', 'RSSHUB_ACCESS_KEY', 'RSSHUB_TEST_BASE_URL']);

for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required GitHub secret: ${name}`);
}

const state = JSON.parse(await readFile(statePath, 'utf8'));
const tempRoot = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'rsshub-upstream-'));
const repo = path.join(tempRoot, 'rsshub');
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !secretNames.has(name)));
const deployEnv = { ...safeEnv, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID };

async function run(command, args, options = {}) {
    const result = await exec(command, args, { cwd: repo, env: safeEnv, maxBuffer: 32 * 1024 * 1024, ...options });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result;
}

async function copyTemplate(name, target) {
    await cp(path.join(templateRoot, name), path.join(repo, target));
}

async function probe(pathname, expectedStatus, key = false) {
    const url = new URL(pathname, process.env.RSSHUB_TEST_BASE_URL);
    if (key) url.searchParams.set('key', process.env.RSSHUB_ACCESS_KEY);
    const expectsFeed = key && pathname !== '/healthz';
    if (expectsFeed) url.searchParams.set('limit', '3');
    try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
        const body = expectsFeed ? await response.text() : '';
        if (!expectsFeed) await response.body?.cancel();
        if (response.status !== expectedStatus) return { pathname, ok: false, status: response.status };
        if (expectsFeed && !/<rss[\s>]|<feed[\s>]/i.test(body)) return {pathname,ok:false,status:response.status,reason:'not_rss'};
        return { pathname, ok: true, status: response.status };
    } catch {
        return { pathname, ok: false, status: null };
    }
}

async function main() {
try {
    const remote = await run('git', ['ls-remote', '--heads', 'https://github.com/DIYgod/RSSHub.git', 'refs/heads/master'], {cwd: tempRoot});
    let upstreamSha = remote.stdout.trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(upstreamSha)) throw new Error('Could not resolve the official upstream master revision.');
    if (state.upstreamSha === upstreamSha && process.env.FORCE_REBUILD !== 'true') {
        console.log(`RSSHub upstream ${upstreamSha} is already deployed; skipping build.`);
        return;
    }
    await run('git', ['clone', '--depth=1', '--branch', 'master', 'https://github.com/DIYgod/RSSHub.git', repo], {cwd:tempRoot});
    upstreamSha = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const packageJson = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
    const packageManager = packageJson.packageManager;
    if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) throw new Error('Upstream package.json did not declare pnpm');

    await run('npm', ['install', '--global', 'corepack@latest']);
    await run('corepack', ['enable']);
    await run('corepack', ['install', '--global', packageManager]);
    const buildEnv = { ...safeEnv, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', PUPPETEER_SKIP_DOWNLOAD: 'true', CI: '1' };
    await run('pnpm', ['install', '--frozen-lockfile'], { env: buildEnv });
    await copyTemplate('playwright-disabled.ts', '.dev.playwright-disabled.ts');
    await copyTemplate('tsdown-free.config.ts', '.dev.tsdown-free.config.ts');
    await copyTemplate('free-profile-safe.mjs', '.dev.profile-free-safe.mjs');
    await copyTemplate('runtime-wrapper.mjs', '.dev.runtime-do.mjs');
    await run('pnpm', ['exec', 'tsx', 'scripts/workflow/build-playwright-worker.ts'], { env: buildEnv });
    await run('pnpm', ['exec', 'tsx', 'scripts/workflow/build-routes.ts'], { env: { ...buildEnv, NODE_ENV: 'dev', WORKER_BUILD: 'true' } });
    await run('node', ['.dev.profile-free-safe.mjs']);
    await run('pnpm', ['exec', 'tsdown', '--config', '.dev.tsdown-free.config.ts'], {env:{...buildEnv,NODE_ENV:'production'}});

    const wrangler = {
        name: 'zackrsshub-core',
        main: '.dev.runtime-do.mjs',
        compatibility_date: '2026-10-04',
        compatibility_flags: ['nodejs_compat'],
        assets: { directory: 'lib/assets' },
        workers_dev: false,
        preview_urls: false,
        observability: {enabled:false},
        account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
        durable_objects: { bindings: [{ name: 'RSSHUB_RUNTIME', class_name: 'RSSHubRuntime' }] },
        migrations: [{ tag: 'rsshub-do-v1', new_sqlite_classes: ['RSSHubRuntime'] }],
        kv_namespaces: [{ binding: 'CACHE', id: process.env.RSSHUB_CACHE_KV_ID }],
        vars: { DEBUG_INFO: 'false', DISALLOW_ROBOT: 'true', CACHE_EXPIRE: '1800', CACHE_CONTENT_EXPIRE: '3600' },
    };
    await writeFile(path.join(repo, 'wrangler-rsshub-core.json'), JSON.stringify(wrangler, null, 2));
    const deployments = await run('pnpm', ['exec', 'wrangler', 'deployments', 'list', '--config', 'wrangler-rsshub-core.json', '--json'], { env: deployEnv });
    const deploymentData = JSON.parse(deployments.stdout);
    const deploymentItems = Array.isArray(deploymentData) ? deploymentData : deploymentData.deployments || deploymentData.items || [];
    const latestDeployment = deploymentItems.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    if (latestDeployment?.versions?.length !== 1 || latestDeployment.versions[0].percentage !== 100) {
        throw new Error('Expected one fully deployed production version before automated update.');
    }
    const previousVersionId = latestDeployment.versions[0].version_id;
    if (!/^[0-9a-f-]{36}$/.test(previousVersionId)) throw new Error('Missing rollback version ID.');
    await run('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'wrangler-rsshub-core.json'], { env: deployEnv });

    const coreChecks = [await probe('/', 200), await probe('/healthz', 403), await probe('/healthz', 200, true), await probe('/test/1', 200, true)];
    if (coreChecks.some((result) => !result.ok)) {
        if (previousVersionId) {
            await run('pnpm', ['exec', 'wrangler', 'rollback', previousVersionId, '--config', 'wrangler-rsshub-core.json', '--yes', '--message', 'Automatic rollback after core verification failure'], { env: deployEnv });
        }
        throw new Error(`Core verification failed: ${JSON.stringify(coreChecks.map(({ pathname, ok, status }) => ({ pathname, ok, status })))}`);
    }
    const sourceChecks = await Promise.all([
        probe('/zjmuseum/exhibition/ondisplay', 200, true),
        probe('/home-assistant/hacs/repositories', 200, true),
        probe('/telegram/channel/awesomeRSSHub', 200, true),
    ]);
    console.log(`Source verification report: ${JSON.stringify(sourceChecks)}`);
    await writeFile(statePath, JSON.stringify({ upstreamSha, deployedAt: new Date().toISOString() }, null, 2) + '\n');
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}
}
await main();

