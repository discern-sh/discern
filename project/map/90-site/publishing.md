---
aliases:
  - deploy discern.sh
  - site deployment
  - deno deploy
  - run site locally
---

# Publishing the site

The site consists of one fetch handler and static files. Publishing runs that handler at a public address. Local and production both run [`site/serve.ts`](../../../site/serve.ts), so the local preview uses the production rendering path.

## Run it locally

```sh
deno task site                    # main: :4507; worktree: its discern port
deno task watch                   # same URL; rebuild when authored inputs change
deno task site:build
deno task site:smoke              # build, self-host, and crawl the real handler
deno serve --host 127.0.0.1 --allow-read --port 9000 site/serve.ts  # after build
```

The `site` task first runs `site:build`, which deterministically creates the ignored design-system marketing shells and assets. It then serves the same handler on the loopback-only `http://localhost:4507/` in the main checkout. In a discern worktree, both tasks discover its deterministic identity port automatically, so concurrent previews use separate ports. An explicit `PORT` takes precedence. The `watch` task performs the same initial build, then rebuilds in a fresh Deno process when marketing sources, the manual, the map, shared document primitives, the site-owned design-system selection, or build configuration changes. [`SITE_BUILD_INPUTS`](../../../site/build_inputs.ts) is that watched boundary. After a watched rebuild fails, the watcher reports the failure and waits for a correcting edit. Local and production expose the same route surface. The generic component catalog lives in the design-system package repository and the discern site does not mount it.

Local preview processes identify themselves only at `127.0.0.1`. A new one-shot `site` run builds successfully before it asks a compatible older one-shot preview from the same checkout to close, then serves the fresh build at the same URL. An existing `watch` preview stays in place because it already rebuilds authored changes; another `site` or `watch` invocation prints that live URL instead. An unrelated or older process is never killed blindly: the task reports the occupied browser URL and tells the user to open it or select another `PORT`.

Deno Deploy runs the same build task before it starts the handler through the [`site/main.ts`](../../../site/main.ts) `Deno.serve` entrypoint. The current Deno Deploy runs an entrypoint with `deno run`, as described below. A build failure stops the deployment before the revision receives traffic.

The [release-page review journey](releases.md#visual-and-accessibility-review) exercises published comparisons through the production handler using synthetic records. A normal local build has no publication snapshot and therefore labels its authored notes as unpublished. Keep fixture publication evidence out of the source and deployment input.

## Canonical domains and removals

The handler folds Hypertext Transfer Protocol (HTTP) and `www.discern.sh` onto `https://discern.sh` with a 308 after the request reaches the application. Attach both apex and `www` as custom domains in Deno Deploy, provision Transport Layer Security (TLS) for both, and create every Domain Name System (DNS) record Deploy supplies. The same handler resolves canonical path variants in one hop ([ADR 0144](../_adr/0144-canonical-site-urls-and-one-hop-redirects.md)). No pre-public manual route is claimed as a historical redirect; the explicit redirect registry starts empty.

An unknown path returns 404 because the server has no evidence that it used to exist. Use 410 only for a known public address removed without a replacement and recorded in an explicit tombstone registry. Use a redirect whenever a live replacement exists. A renamed heading keeps an explicit old-ID anchor in its page because HTTP requests omit fragments.

Check both readers:

```sh
curl -s localhost:4507/           # prints the llms.txt plaintext edition
open http://localhost:4507/       # renders the generated design-system homepage
```

## Deploy to production (Deno Deploy)

> Deno's migration guide scheduled the **Deploy Classic** dashboard at `dash.deno.com` to shut down on **July 20, 2026**. Set the site up on the current Deno Deploy at <https://console.deno.com>. A new site follows the steps below. Use the [migration guide](https://docs.deno.com/deploy/migration_guide/) to move a pre-existing Classic project, and verify the current platform state before migration.

The production target is [Deno Deploy](https://console.deno.com). It runs the handler at the edge and manages TLS and custom domains. The current platform runs an app's entrypoint with `deno run` and waits for it to start a server. The entrypoint is [`site/main.ts`](../../../site/main.ts), a one-line `Deno.serve` over the handler. The bare `{ fetch }` export in `site/serve.ts` binds no port under `deno run`. Exercise the production entrypoint locally first:

```sh
deno task site:build
deno run --allow-read --allow-net --allow-env site/main.ts   # http://localhost:8000
```

One-time setup, using the console at <https://console.deno.com> and the [`deno deploy` command](https://docs.deno.com/runtime/reference/cli/deploy/) ([getting started](https://docs.deno.com/deploy/getting_started/)):

1. Create an organization, then create the application as a **local-source** app. Do not link its source to GitHub: a linked default branch would restore the forbidden deploy-on-`main` path. The root `deno.json` supplies the organization slug, the application name, `deno task site:build`, and the dynamic `site/main.ts` entrypoint in its `deploy` block.
2. Create a GitHub environment named `production` with one secret, `DENO_DEPLOY_TOKEN`, containing a Deno Deploy organization token. The deploy tool reads the organization and application from `deno.json`, so the environment carries no variables.
3. Add both `discern.sh` and `www.discern.sh` under the organization's Domains. At the registrar, create the `_acme-challenge` and apex/`www` routing records the console lists. If DNS sits behind Cloudflare, keep the challenge record DNS-only or verification stalls. See the [domains reference](https://docs.deno.com/deploy/reference/domains/).

Production is published only by [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) ([ADR 0145](../_adr/0145-production-site-deploys-only-from-release-tags.md)). A `v*` tag first requires [complete hosted gate evidence](../20-quality-gate/ci.md#reuse-the-gate-for-a-release) for its exact commit. Publication then enters [`scripts/release_plan.ts`](../../../scripts/release_plan.ts), which refuses while GitHub reports the repository as private. Dispatch retries obey the same refusal. A public tag must match `deno.json`; a prerelease SemVer becomes a GitHub prerelease and cannot become `latest`. The plan then derives every build from [`scripts/build_targets.ts`](../../../scripts/build_targets.ts). Each target compiles with the exact Deno version in [`.dvmrc`](../../../.dvmrc) and executes on a pinned native runner. Its binary must report the release version, serve its embedded help, scaffold a fresh repository from its embedded templates, and contain none of the release host's checkout, workspace, runner-temp, or package-cache paths before the workflow creates a checksum.

The macOS jobs sign those binaries with Developer ID, run the smoke over the signed bytes, submit them to Apple's notary service, and verify the online notarization ticket before creating the checksum. The raw executable format cannot carry a stapled ticket, so a quarantined browser download needs network access when Gatekeeper first assesses it ([ADR 0199](../_adr/0199-macos-release-binaries-are-developer-id-signed-and-notarized.md)).

GitHub then records build provenance for the binary and checksum before artifact upload on every tag. The attestation step carries no condition: the plan job has already refused any tag on a private repository, where attestations would need GitHub Enterprise Cloud. Full commit hashes pin every remote action in the workflows. A directory-wide guard enrolls future workflow files and steps in the same rule. See GitHub's [artifact-attestation instructions](https://docs.github.com/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) for independent verification.

The site job checks out the same tag, observes the published release assets, stages the validated publication input, runs the site build, and sends that source snapshot to the deploy tool with `--prod`. The tool runs directly and pinned (`deno run -A jsr:@deno/deploy@<version>`, locked in `deno.lock`) because the `deno deploy` wrapper in the pinned Deno forwards every option twice. The remote build consumes the same publication input. `/site/release-publication.json` is ignored by Git because it is an observation staged for one deployment; authored release notes remain tracked. Re-run the same tag only while it satisfies the [release catalogue ordering contract](releases.md#publication-evidence). An older rerun cannot replace newer published history. Production deployments exclude arbitrary local checkouts.

Before the first release, the setup can be exercised against a throwaway app:

```sh
deno run -A --no-lock jsr:@deno/deploy@0.0.9904 create --source local --org <org> --app <app>
```

## Verify a deploy

Run the process smoke from the exact release-tag checkout that production should match. It compares the deployed sitemap with that checkout's live route model, then crawls every canonical HTML route, pristine Markdown and negotiated text route, internal link and anchor, redirect variant, metadata field, security response, machine projection, 404, and method refusal. `--production-domains` also proves HTTP and `www` fold directly onto the apex HTTPS canonical:

```sh
deno run --allow-read --allow-env --allow-net=discern.sh,www.discern.sh scripts/site_smoke.ts https://discern.sh --production-domains
```

External destinations depend on the network and on third-party rate limits, so they stay outside the local gate. For a release audit, opt into them separately:

```sh
deno run --allow-read --allow-env --allow-net scripts/site_smoke.ts https://discern.sh --production-domains --external-links
```

The external pass treats ordinary HTTP errors as failures. It reports authentication responses, rate limits, timeouts, and transport errors as inconclusive for manual follow-up because those results do not prove a dead link.

```sh
curl -s https://discern.sh/ | head -3        # llms.txt heading and summary
curl -s https://discern.sh/llms.txt | head -3
curl -s https://discern.sh/llms-full.txt | head -3
curl -s https://discern.sh/.well-known/security.txt
curl -s -H "Accept: text/html" -A "Mozilla/5.0" https://discern.sh/ | head -2
curl -sI https://www.discern.sh/docs/ | grep -Ei '^(HTTP|location:)'
```

The commands return, in order, three plaintext editions, a Request for Comments (RFC) 9116 plaintext policy, an HTML page, and one 308 to `https://discern.sh/docs`. [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) holds the process smoke in the gate. The smaller route tests in [`tests/site_serve_test.ts`](../../../tests/site_serve_test.ts) retain focused diagnostics. When both pass and production fails, check the hosting layer and release alignment.

## Canonical headers and shared caching

Responses with canonical `Link` metadata of at least 128 bytes set `Deno-CDN-Cache-Control: no-store`. Shorter canonical headers retain normal shared caching; browser cache policy remains unchanged. This conservative boundary keeps long URL metadata outside the hosted cache path. Deno's [cache-control precedence](https://docs.deno.com/deploy/reference/caching/#deno-cdn-cache-control) permits this separate policy.

After deployment, request a long-route HTML page and its Markdown edition repeatedly. Require the complete canonical header on every response and confirm that the shared cache bypass applies. Local route tests cover the response contract for every registered page; they cannot establish a hosted cache's behavior. Review the bypass when the hosting service can preserve long canonical headers.

## Portability

The handler uses web-standard application programming interfaces (APIs) plus `Deno.readFile`. To move off Deno Deploy, run the same handler anywhere that supports a fetch handler. Cloudflare Workers requires static assets in place of file reads. A container can run `deno run -A site/main.ts` behind a reverse proxy; the entrypoint honors `PORT`.
