import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('production Durable Object binding and migration names stay stable', async () => {
    const source = await readFile(new URL('scripts/build-and-deploy.mjs', root), 'utf8');
    const wrapper = await readFile(new URL('templates/runtime-wrapper.mjs', root), 'utf8');
    assert.match(source, /name: 'RSSHUB_RUNTIME'/);
    assert.match(source, /class_name: 'RSSHubRuntime'/);
    assert.match(source, /tag: 'rsshub-do-v1'/);
    assert.match(wrapper, /idFromName\('rsshub'\)/);
});

test('secret values never appear in probe error text', async () => {
    const source = await readFile(new URL('scripts/build-and-deploy.mjs', root), 'utf8');
    assert.match(source, /return \{ pathname, ok: false, status: response\.status \}/);
    assert.doesNotMatch(source, /console\.log\([^\n]*RSSHUB_ACCESS_KEY/);
});

test('the workflow records the deployed revision with write permission', async () => {
    const workflow = await readFile(new URL('.github/workflows/rsshub-upstream.yml', root), 'utf8');
    assert.match(workflow, /contents: write/);
    assert.match(workflow, /node scripts\/build-and-deploy\.mjs/);
    assert.match(workflow, /git add state\/upstream-sha\.json/);
    assert.match(workflow, /force:/);
    assert.match(workflow, /cancel-in-progress: false/);
});
