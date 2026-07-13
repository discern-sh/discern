# ADR 0136: Third-party notices derive from the compile graph

**Status**: accepted — replaces the hand-maintained notices manifest (launch
task 1.2, never ADR'd). Applies the generated-artifact discipline of
[ADR 0026](0026-typed-config-schema.md) and the forcing-function guard pattern
of [ADR 0051](0051-canonical-set-parity.md) to license attribution.

## Context

Distributing the compiled binary means reproducing the copyright notice and
license text of every third-party component it embeds — MIT, ISC, and BSD all
require it. The first cut was a hand-maintained manifest: a TypeScript array of
packages, versions, and copyright lines, plus one shared body per license
family. Tests tied it to `deno.lock` and the `src/` imports.

It had two defects, one structural and one factual.

**Structural**: the manifest was a second source of truth. The resolver already
knows the component set, and the packages already ship their own license texts.
A hand-copied mirror of both can only drift, and every dependency bump demanded
a parallel edit under test duress.

**Factual**: the manifest excluded the MCP SDK's HTTP/SSE transport dependencies
(express, hono, cors, jose, and their closures). The stated reasoning: they are
"not reachable from the stdio entry points discern imports." That is file-level,
ESM-shaped reasoning — but `deno compile` embeds npm dependencies at **package
granularity**. There is no tree-shaking inside npm packages: the whole
dependency closure of an imported package ships. Strings in the released binary
confirmed it: express-rate-limit's versioned snapshot key, hono source, and
Express's verbatim copyright line were all embedded, none credited.

The failure modes are asymmetric. Crediting a package the binary does not embed
is legally harmless. Omitting one it does embed violates the license. Any
approximation must therefore err toward inclusion — the manifest's hand-pruning
erred the other way.

## Decision

**The graph decides.** `deno task codegen` derives the component set from
`deno info --json src/main.ts` — the account the resolver itself gives of what
`deno compile` embeds — and reproduces each package's own LICENSE file verbatim.
No human judgment sits between the dependency graph and the notices.

1. **JSR components** are the packages behind the graph's `https://jsr.io/…`
   modules. **npm components** are the dependency closure of the graph's npm
   roots, walked over the resolution snapshot at package granularity — the same
   set the compiler materializes. The walk drops packages in the snapshot but
   outside the closure (other workspace roots). Type-only roots stay in, because
   over-inclusion is the safe direction.
2. **License texts ship verbatim, from the packages themselves.** npm texts come
   from the extracted package store, with the `package.json` license field as
   the label. Codegen fetches a JSR text once from jsr.io — which requires every
   package to publish a LICENSE — into a committed cache, so regeneration and
   the gate stay offline. A package with no resolvable license fails generation.
   `LICENSE_OVERRIDES` is the deliberate, per-version escape hatch (empty
   today), never a second manifest.
3. **The binary embeds the committed notices.** `discern licenses` prints them
   from a generated bundle module compiled into the binary, so an install's
   notices always match its build. Codegen compresses the bundle — license text
   repeats the same few bodies — so the notices hold the `binary_size` ceiling
   rather than raising it, and a drift test pins the bundle to the readable
   `THIRD_PARTY_NOTICES`.
4. **The notices credit the Deno runtime.** The binary also embeds the runtime.
   A fixed section credits the Deno authors (MIT) and points to Deno's own
   published license and notices rather than enumerating its Rust-crate closure.
5. **Guards hold the tie** (`tests/third_party_notices_test.ts`): offline
   regeneration parity (a dependency change without `deno task codegen` fails
   the gate); closure-closedness with `deno.lock` as an independent oracle (a
   generator regression that drops part of the embedded closure — this ADR's
   originating defect class — fails even though regeneration is
   self-consistent); and direct-import coverage via the import map.

## Consequences

- Adding, removing, or bumping a dependency auto-enrols it in the notices; the
  gate fails until codegen runs. There is no per-dependency attribution work and
  no copyright line to transcribe.
- The notices list the full embedded closure (about 114 components today,
  express and hono included). Long attribution files are the norm, not a defect.
- Codegen now shells out to `deno info` and, only when a new JSR dependency
  appears, fetches its LICENSE from jsr.io; the committed cache keeps every
  other run — including the drift guard — offline and deterministic.
- A future dependency under a copyleft or otherwise surprising license surfaces
  in the regenerated diff at review time instead of slipping past unseen.
