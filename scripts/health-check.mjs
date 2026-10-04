import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'state', 'health-check.json');
let previous;
try {
    previous = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}
const elapsed = Date.now() - Date.parse(previous?.checkedAt);
if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 7 * 24 * 60 * 60 * 1000) {
    console.log('The weekly service health check is not due yet.');
    process.exit(0);
}
const baseUrl = process.env.RSSHUB_TEST_BASE_URL;
const accessKey = process.env.RSSHUB_ACCESS_KEY;
if (!baseUrl || !accessKey) throw new Error('RSSHUB_TEST_BASE_URL and RSSHUB_ACCESS_KEY are required');

const checks = [
    { path: '/', expected: 200, authenticated: false },
    { path: '/healthz', expected: 403, authenticated: false },
    { path: '/healthz', expected: 200, authenticated: true },
    { path: '/test/1', expected: 200, authenticated: true, requireFeed: true },
];
const results = [];
for (const check of checks) {
    const url = new URL(check.path, baseUrl);
    if (check.authenticated) url.searchParams.set('key', accessKey);
    try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(90_000) });
        const body = check.requireFeed ? await response.text() : '';
        if (!check.requireFeed) await response.body?.cancel();
        const feedValid = !check.requireFeed || /<rss[\s>]|<feed[\s>]/i.test(body);
        results.push({ path: check.path, authenticated: check.authenticated, expected: check.expected, status: response.status, ok: response.status === check.expected && feedValid });
    } catch {
        results.push({ path: check.path, authenticated: check.authenticated, expected: check.expected, status: null, ok: false });
    }
}
const output = { checkedAt: new Date().toISOString(), ok: results.every(result => result.ok), results };
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`);
// Persist response metadata only; credentials, URLs and response bodies stay private.
console.log(JSON.stringify(output));
if (!output.ok) process.exitCode = 1;
