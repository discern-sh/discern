# Publishing the site

The site is one fetch handler plus static files; publishing it is running that
handler somewhere public. Local and production run the same handler —
[`site/serve.ts`](../../site/serve.ts) — so what renders locally is what
production serves.

## Run it locally

```sh
deno task site                    # http://localhost:4507
deno serve --allow-read --port 9000 site/serve.ts   # any other port
```

The task runs `deno serve`, which consumes the handler's default `{ fetch }`
export. Production starts the same handler a different way — a `Deno.serve`
entrypoint, [`site/main.ts`](../../site/main.ts) — because the new Deno Deploy
runs an entrypoint with `deno run` (see below).

Check both readers:

```sh
curl -s localhost:4507/           # prints the DISCERN(1) plaintext edition
open http://localhost:4507/       # renders the engineers edition
```

## Deploy to production (Deno Deploy)

> The old dashboard at `dash.deno.com` is **Deploy Classic**, which shuts down
> on **20 July 2026**. Set the site up on the new Deno Deploy at
> <https://console.deno.com>. A fresh site skips straight to the steps below;
> the [migration guide](https://docs.deno.com/deploy/migration_guide/) is only
> needed to move a pre-existing Classic project.

The production target is [Deno Deploy](https://console.deno.com): it runs the
handler at the edge, with TLS and custom domains managed for you. The new
platform runs an app's entrypoint with `deno run` and waits for it to start a
server, so the entrypoint is [`site/main.ts`](../../site/main.ts) — a one-line
`Deno.serve` over the handler — not `site/serve.ts`, whose bare `{ fetch }`
export never binds a port under `deno run`
([ADR 0132](../_adr/0132-site-deploys-via-a-deno-serve-entrypoint.md)). Exercise
the exact production path locally first:

```sh
deno run --allow-read --allow-net --allow-env site/main.ts   # http://localhost:8000
```

One-time setup, in the console at <https://console.deno.com>
([getting started](https://docs.deno.com/deploy/getting_started/)):

1. Create an organization (the new platform requires one before any app), then
   create an application inside it.
2. Link this GitHub repository. Builds are integrated — no GitHub Actions YAML.
   Pick "No Preset" (the site is not a framework app), set the entrypoint to
   `site/main.ts`, and leave the install and build steps empty; the site has
   none.
3. Add the custom domain `discern.sh` under the organization's Domains, then at
   the registrar create the records the console lists — the `_acme-challenge`
   record it shows (so Deploy can provision the TLS certificate) and the
   `CNAME`/`ANAME` that points the domain at the app. If the DNS sits behind
   Cloudflare, leave the `_acme-challenge` record unproxied (grey cloud) or
   verification stalls. See the
   [domains reference](https://docs.deno.com/deploy/reference/domains/).

After that, every push to `main` deploys automatically. A manual deploy from a
checkout uses the `deno deploy` subcommand built into the runtime — `deployctl`
retired with Classic:

```sh
deno deploy    # the first run walks a wizard to create or link the app
```

## Verify a deploy

```sh
curl -s https://discern.sh/ | head -3        # DISCERN(1) masthead
curl -s https://discern.sh/llms.txt | head -3
curl -s -H "Accept: text/html" -A "Mozilla/5.0" https://discern.sh/ | head -2
```

The three responses are: plaintext, plaintext, HTML. The route tests in
[`tests/site_serve_test.ts`](../../tests/site_serve_test.ts) assert the same
behaviour against the handler directly, so a failure here that the gate did not
catch points at the hosting layer, not the code.

## Portability

The handler uses web-standard APIs plus `Deno.readFile`. Moving off Deno Deploy
means running the same handler anywhere a fetch handler runs — Cloudflare
Workers (swap the file reads for static assets), or a container running
`deno run -A site/main.ts` (the entrypoint honours `PORT`) behind any reverse
proxy.
