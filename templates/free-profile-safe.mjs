import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const catalogFile = new URL('./assets/build/routes-worker.js', import.meta.url);
const original = await readFile(catalogFile, 'utf8');
const { default: namespaces } = await import(catalogFile.href);
const report = { generatedAt: new Date().toISOString(), enabled: [], deferred: [] };

for (const [namespace, group] of Object.entries(namespaces)) {
    for (const collection of ['routes', 'apiRoutes']) {
        for (const [routePath, route] of Object.entries(group[collection] ?? {})) {
            const required = Array.isArray(route.features?.requireConfig)
                ? route.features.requireConfig.filter((entry) => !entry.optional).map((entry) => entry.name)
                : [];
            const reasons = [];
            if (route.features?.requirePuppeteer) reasons.push('browser runtime');
            if (required.length) reasons.push(`required configuration: ${required.join(', ')}`);
            const item = { path: `/${namespace}${routePath}`, name: route.name, reasons };
            if (reasons.length) {
                report.deferred.push(item);
                delete group[collection][routePath];
            } else {
                report.enabled.push(item);
            }
        }
    }
    if (!Object.keys(group.routes ?? {}).length && !Object.keys(group.apiRoutes ?? {}).length) delete namespaces[namespace];
}

const modules = new Map();
let moduleNumber = 0;
const serialized = JSON.stringify(namespaces, (key, value) => {
    if (key !== 'module' || typeof value !== 'function') return value;
    const marker = `__RSSHUB_DEPLOY_MODULE_${moduleNumber++}__`;
    modules.set(marker, value.toString());
    return marker;
}, 2);
let source = `export default ${serialized}`;
for (const [marker, moduleSource] of modules) source = source.replace(JSON.stringify(marker), moduleSource);
await writeFile(catalogFile, source);
const rebuilt = (await import(`${catalogFile.href}?filtered=1`)).default;
for (const [namespace, group] of Object.entries(rebuilt)) {
    for (const collection of ['routes', 'apiRoutes']) {
        for (const [routePath, route] of Object.entries(group[collection] ?? {})) {
            if (typeof route.module !== 'function') throw new Error(`Invalid generated route module: ${namespace}${routePath}`);
        }
    }
}
await writeFile(path.join(root, '.dev-free-routes.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ enabled: report.enabled.length, deferred: report.deferred.length, namespaces: Object.keys(namespaces).length }));

// Keep the variable as an explicit reminder that this script intentionally
// changes only the disposable build checkout created by the workflow.
void original;
