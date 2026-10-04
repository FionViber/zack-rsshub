# RSSHub on Cloudflare Free

This repository automatically checks the official `DIYgod/RSSHub` master revision every hour. Only a changed revision is cloned and built. The workflow reads the upstream `packageManager`, installs with its declared pnpm version, builds the official Worker, applies the no-mandatory-credentials/no-browser profile, runs RSSHub in a SQLite-backed Durable Object, deploys the existing Worker name and checks the result. The native homepage, key/code authentication and public address are preserved.

It does not contain an OAuth token, Cloudflare API token, RSSHub access key, real KV ID, or deployment URL. It does not modify the local `rsshub` source or existing `dist-worker`.

## Required GitHub Actions secrets

- `CLOUDFLARE_API_TOKEN`: a minimum scoped Cloudflare API token able to deploy Workers and update the existing Durable Object migration. It should not be an account-wide API key. The token must be created by the account owner in Cloudflare.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account identifier.
- `RSSHUB_CACHE_KV_ID`: the existing RSSHub cache KV namespace ID.
- `RSSHUB_ACCESS_KEY`: the existing native RSSHub access key. It is used only in memory for post-deploy checks and is never printed or written by the workflow.
- `RSSHUB_TEST_BASE_URL`: the public URL reached by the Pages/service binding after deployment, for example the existing RSSHub Pages URL. This is only used for the post-deploy checks.

The workflow requires `contents: write` to record the actually deployed upstream SHA in `state/upstream-sha.json`. It can be run manually with `force=true` for the first complete validation. A concurrency lock prevents overlapping deployments. Set repository variable `RSSHUB_AUTO_UPDATE_ENABLED` to `true` after a successful manual run; scheduled jobs are skipped until it is set. Unchanged upstream revisions skip dependency installation and deployment. No Render service is used.

## Weekly service health report

The hourly workflow also checks whether the last service health report is at least seven days old. When due, it checks the homepage, anonymous and authenticated health endpoint, and the built-in RSS test route. It commits the timestamp and response status to `state/health-check.json`, including failed checks. A failed check leaves the workflow visibly failed. The report contains no credentials, response bodies or private deployment URL.

These actual report commits provide regular repository activity even when the upstream revision is unchanged. Scheduled workflow runs alone do not provide this assurance: GitHub automatically disables scheduled workflows after 60 days without repository activity in a public repository. The weekly report uses the existing workflow permissions, without an additional account token. If the workflow is manually disabled or its write permission is removed, it needs to be restored in GitHub Actions.

## Free profile behavior

The workflow copies `templates/free-profile-safe.mjs` into the disposable upstream checkout. It filters routes that require non-optional credentials or a browser runtime and writes the filtered route catalog only inside that temporary checkout. The script does not create a full catalog backup beside the production build, and cleanup removes the entire temporary checkout on success or failure.

The browser adapter is replaced with an explicit unavailable error. No cookies, provider API keys, Chromium, Browserless, or browser binding are added. The upstream `packageManager` field controls the pnpm version; it is not hardcoded to an old version.

The production Durable Object names are preserved exactly: binding `RSSHUB_RUNTIME`, class `RSSHubRuntime`, migration tag `rsshub-do-v1`, and object name `rsshub`. The wrapper is written to the temporary checkout root as `.dev.runtime-do.mjs` and imports `./dist-worker/worker.mjs`, matching the production layout. The existing production `ACCESS_KEY` secret is preserved; the workflow does not run `wrangler secret put`.

Corepack is installed explicitly with `npm install --global corepack@latest` before the build. Build and dependency-install subprocesses receive a sanitized environment without Cloudflare or RSSHub secrets. Only Wrangler deploy/list/rollback subprocesses receive the Cloudflare API token; the RSSHub access key stays in the Node process for checks.

## Post-deploy checks

The workflow checks only these fixed requests:

1. `/` → expected HTTP 200.
2. `/healthz` without a key → expected HTTP 403.
3. `/healthz?key=...` → expected HTTP 200.
4. `/zjmuseum/exhibition/ondisplay?key=...` → expected HTTP 200.
5. `/home-assistant/hacs/repositories?key=...` → expected HTTP 200.
6. `/telegram/channel/awesomeRSSHub?key=...` → expected HTTP 200.

It does not scan the route catalog or run a broad source test. Route requests have generous timeouts because `zjmuseum` previously needed about 22 seconds in the Durable Object test.

Core validation also checks the built-in `/test/1` RSS route. If core checks fail, deployment rolls back using the previous active version ID. Real-source failures are reported separately, because a source outage does not mean the application itself is broken.

Corresponding source is the official RSSHub revision in the state file plus the adapter/profile templates here. RSSHub and this adaptation use AGPL-3.0; see `LICENSE`. Cloudflare Free memory, request and storage quotas still apply. This automation does not upgrade any plan or supply billing credentials.
