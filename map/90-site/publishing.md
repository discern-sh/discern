# Publishing the site

The site is one fetch handler plus static files; publishing it is running that
handler somewhere public. Local and production run the same
[`site/serve.ts`](../../site/serve.ts), so what renders locally is what
production serves.

## Run it locally

```sh
deno task site          # http://localhost:4507
PORT=9000 deno task site
```

Check both readers:

```sh
curl -s localhost:4507/           # prints the DISCERN(1) plaintext edition
open http://localhost:4507/       # renders the engineers edition
```

## Deploy to production (Deno Deploy)

The production target is Deno Deploy: it runs the same handler file at the edge,
with TLS and custom domains managed for you. One-time setup:

1. Sign in at <https://dash.deno.com> with GitHub and create a project (e.g.
   `discern-site`).
2. Link this repository, set the entrypoint to `site/serve.ts`, and pick "just
   link the repo" (no build step — the site has none).
3. Add the custom domain `discern.sh` in the project's settings and create the
   DNS records it lists at the registrar. Deploy provisions the certificate
   itself.

After that, every push to `main` deploys automatically. A manual deploy from a
checkout works too:

```sh
deno run -A jsr:@deno/deployctl deploy --project=discern-site site/serve.ts
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
means running the same file anywhere a fetch handler runs — Cloudflare Workers
(swap the file reads for static assets), or a container running `deno task site`
behind any reverse proxy.
