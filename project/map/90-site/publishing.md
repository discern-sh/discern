# Publishing the site

The site is one fetch handler plus static files; publishing it is running that handler somewhere public. Local and production run the same handler — [`site/serve.ts`](../../../site/serve.ts) — so what renders locally is what production serves.

## Run it locally

```sh
deno task site                    # main: :4507; worktree: its discern port
deno task watch                   # same URL; rebuild when authored inputs change
deno task site:build
deno serve --host 127.0.0.1 --allow-read --port 9000 site/serve.ts  # after build
```

The `site` task first runs `site:build`, which deterministically creates the ignored design-system homepage, composition HTML, and assets, then serves the same handler on the loopback-only `http://localhost:4507/` in the main checkout. In a discern worktree both tasks discover its deterministic identity port automatically, so concurrent previews do not collide; an explicit `PORT` still wins. The `watch` task does the same initial build, then rebuilds in a fresh Deno process when page sources, the site-owned design-system selection, or build configuration changes. A failed watched rebuild is reported and the watcher remains ready for the correcting edit. Local and production expose the same route surface; the generic component catalog lives in the design-system package repository and is not mounted by Discern.

Deno Deploy runs the same build task before it starts the handler through a `Deno.serve` entrypoint, [`site/main.ts`](../../../site/main.ts) — because the new Deno Deploy runs an entrypoint with `deno run` (see below). A build failure stops the deployment before the revision receives traffic.

## Canonical domains and removals

The handler folds HTTP and `www.discern.sh` onto `https://discern.sh` with a 308, but it can do so only after the request reaches the application. Attach both apex and `www` as custom domains in Deno Deploy, provision TLS for both, and create every DNS record Deploy supplies. URL-path variants and historical routes are then resolved by the same handler in one hop ([ADR 0144](../_adr/0144-canonical-site-urls-and-one-hop-redirects.md)).

An unknown path is a 404: the server has no evidence that it used to exist. Use 410 only for a known public URL deliberately removed without a replacement, recorded in an explicit tombstone registry. Prefer a redirect whenever a live replacement exists. A renamed heading keeps an explicit old-ID anchor in its page because fragments are never sent in an HTTP request.

Check both readers:

```sh
curl -s localhost:4507/           # prints the DISCERN(1) plaintext edition
open http://localhost:4507/       # renders the generated design-system homepage
```

## Deploy to production (Deno Deploy)

> The old dashboard at `dash.deno.com` is **Deploy Classic**, which shuts down on **July 20, 2026**. Set the site up on the new Deno Deploy at <https://console.deno.com>. A fresh site skips straight to the steps below; the [migration guide](https://docs.deno.com/deploy/migration_guide/) is only needed to move a pre-existing Classic project.

The production target is [Deno Deploy](https://console.deno.com): it runs the handler at the edge, with TLS and custom domains managed for you. The new platform runs an app's entrypoint with `deno run` and waits for it to start a server, so the entrypoint is [`site/main.ts`](../../../site/main.ts) — a one-line `Deno.serve` over the handler — not `site/serve.ts`, whose bare `{ fetch }` export never binds a port under `deno run`. Exercise the exact production path locally first:

```sh
deno task site:build
deno run --allow-read --allow-net --allow-env site/main.ts   # http://localhost:8000
```

One-time setup, using the console at <https://console.deno.com> and the [`deno deploy` command](https://docs.deno.com/runtime/reference/cli/deploy/) ([getting started](https://docs.deno.com/deploy/getting_started/)):

1. Create an organization, then create the application as a **local-source** app. Do not link its source to GitHub: a linked default branch would restore the forbidden deploy-on-`main` path. The root `deno.json` supplies `deno task site:build` and the dynamic `site/main.ts` entrypoint.
2. Create a GitHub environment named `production`. Add environment variables `DENO_DEPLOY_ORG` and `DENO_DEPLOY_APP`, plus a secret `DENO_DEPLOY_TOKEN` containing a Deno Deploy organization token.
3. Add both `discern.sh` and `www.discern.sh` under the organization's Domains. At the registrar, create the `_acme-challenge` and apex/`www` routing records the console lists. If DNS sits behind Cloudflare, keep the challenge record DNS-only or verification stalls. See the [domains reference](https://docs.deno.com/deploy/reference/domains/).

Production is published only by [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) ([ADR 0145](../_adr/0145-production-site-deploys-only-from-release-tags.md)). Pushing a `v*` tag builds and publishes the binaries first. The dependent site job checks out the exact tag, refuses a tag/version mismatch, runs the site build, then sends that source snapshot to `deno deploy --prod`. Re-run that workflow for the same tag to recover a failed deployment; never deploy an arbitrary checkout manually.

Before the first release, the setup can be exercised against a throwaway app:

```sh
deno deploy create --source local --org <org> --app <app>
```

## Verify a deploy

```sh
curl -s https://discern.sh/ | head -3        # DISCERN(1) masthead
curl -s https://discern.sh/llms.txt | head -3
curl -s https://discern.sh/llms-full.txt | head -3
curl -s -H "Accept: text/html" -A "Mozilla/5.0" https://discern.sh/ | head -2
curl -sI https://www.discern.sh/docs/ | grep -Ei '^(HTTP|location:)'
```

The first four responses are plaintext, plaintext, plaintext, and HTML; the last is one 308 to `https://discern.sh/docs`. The route tests in [`tests/site_serve_test.ts`](../../../tests/site_serve_test.ts) assert the same behavior against the handler directly, so a failure here that the gate did not catch points at the hosting layer, not the code.

## Portability

The handler uses web-standard APIs plus `Deno.readFile`. Moving off Deno Deploy means running the same handler anywhere a fetch handler runs — Cloudflare Workers (swap the file reads for static assets), or a container running `deno run -A site/main.ts` (the entrypoint honours `PORT`) behind any reverse proxy.
