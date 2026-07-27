# ADR 0129: The public site lives in-repo behind one fetch handler

**Status**: accepted

**Release alignment amendment**: [ADR 0145](0145-production-site-deploys-only-from-release-tags.md) changes the production cadence from default-branch deploys to release-tag-only deploys. This ADR's in-repo, one-handler hosting decision remains active.

## Context

discern.sh needs public pages before launch. The domain exists; no hosting does. Three properties were fixed before choosing a mechanism: the site loads locally and renders identically to production; a text client such as `curl` receives a plaintext edition of the agent-facing content, since in 2026 the first reader of a tool's marketing is often a coding agent; and the pages are covered by the same gate as everything else in this repository, because a site that markets a quality gate should sit behind one.

Static hosts (Netlify, Cloudflare Pages, GitHub Pages) serve files but cannot vary a response by reader without their proprietary edge-function layers, which breaks the local-equals-production property. A separate site repository would take the pages out from under this repo's gate and split the launch surface across two histories.

## Decision

The site lives in `site/` in this repository: static editions under `site/pages/`, the plaintext edition at `site/text/discern.txt`, and one standard web `fetch` handler in `site/serve.ts` that serves them. The handler negotiates the reader on `/` and `/agents` — browsers receive HTML; curl-class clients receive DISCERN(1) as plain text — and `/llms.txt` serves the plaintext for every reader.

`deno task site` runs the handler locally; production runs the same file on Deno Deploy. The handler uses only web-standard APIs plus `Deno.readFile`, so it ports to any fetch-handler runtime with minimal change.

Tests drive off the exported route table: every declared route must serve its page, and negotiation is asserted per route, so a new page auto-enrols into coverage.

## Consequences

- Local rendering equals production by construction — the same handler and files run in both places, not an approximation of them.
- The gate formats, lints, type-checks, and tests the site alongside the engine; a broken route or missing page fails `discern done`.
- The site inherits this repo's release cadence: publishing a page is a landing on `main` plus a deploy, not a separate pipeline.
- Deno Deploy is the production target but not a lock-in: the handler is a plain `fetch` function, portable to Cloudflare Workers or a container behind any reverse proxy.
