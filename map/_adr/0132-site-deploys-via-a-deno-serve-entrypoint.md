# ADR 0132: The site deploys on the new Deno Deploy through a `Deno.serve` entrypoint

**Status**: accepted

## Context

The site (ADR 0129) targets Deno Deploy. Deploy Classic — the `dash.deno.com`
dashboard the publishing notes were written against — shuts down on July 20,
2026, superseded by the new Deno Deploy at `console.deno.com`. The platforms
differ in a way that reaches the code, not just the setup screens.

Deploy Classic ran an entrypoint that exported a default `{ fetch }` object —
the same shape `deno serve` consumes — so `site/serve.ts` was the entrypoint
verbatim and local `deno serve` and production ran the identical file. The new
platform runs an app's entrypoint with `deno run` and waits for it to start an
HTTP server. Under `deno run` a bare `{ fetch }` export binds nothing — Deno
even warns `did you mean to run "deno serve"?` and exits 0 — so pointing the new
platform at `serve.ts` would hang at warmup.

A single self-starting file can't cover both runners: `import.meta.main` is true
under `deno serve` _and_ `deno run`, so a guarded top-level `Deno.serve` inside
`serve.ts` would double-bind under local `deno serve`.

## Decision

Production runs a dedicated entrypoint, `site/main.ts`: a `Deno.serve` over the
handler imported from `serve.ts`, honouring `PORT`. `serve.ts` is unchanged — it
keeps its default `{ fetch }` export for local `deno serve` and for the
portability ADR 0129 promises (Cloudflare Workers, a container behind a proxy).
The handler is still defined once and serves both paths; only the lines that
start the server differ.

Deploys use the GitHub integration (a push to `main` builds and ships, no
Actions YAML) or the `deno deploy` subcommand built into the runtime;
`deployctl` is retired alongside Classic.

## Consequences

- The parity guarantee narrows from "the same file is the entrypoint everywhere"
  to "the same handler serves both paths" — local `deno serve` still exercises
  the exact request handler, which is where all the behaviour lives.
- A structural guard in `tests/site_serve_test.ts` pins `main.ts` to a
  `Deno.serve` over `serve.ts`'s handler, so the entrypoint can't be dropped or
  quietly rewired to a different handler without failing the gate.
- The app and the `discern.sh` custom domain must be recreated on
  `console.deno.com`; Classic projects do not transfer. This is one-time
  maintainer work tracked in `TODO.md`.
- Local dev is unchanged: `deno task site` still runs `deno serve` on 4507. The
  production path can be exercised locally with `deno run -A site/main.ts`.
