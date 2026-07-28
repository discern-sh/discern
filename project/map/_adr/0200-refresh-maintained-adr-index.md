# ADR 0200: The ADR index is a refresh-maintained artifact, opted into by markers

**Status**: accepted

## Context

The ADR README is the only view of the record set most readers ever open, so a record missing from its index is invisible — exactly how ADRs 0106–0109 once sat unlisted for four consecutive records. This repo closed that hole for itself with a codegen step (`scripts/codegen.ts` rewrote the marker-delimited lists) and a repo-local guard (`tests/adr_index_test.ts`).

Both were dogfood-only. The rendering machinery shipped in the binary, but no shipped verb ever called it: a user project that adopted the ADR discipline got a format guide and a template from the setup skeleton, no index, and no guard against the index rotting if they built one by hand. With launch imminent, the feature had to ship through the engine every project runs — under two constraints settled up front: no new configuration (an in-flight launch branch owns schema changes), and no behaviour change for existing installs that never asked for an index.

## Decision

**The maintained ADR index is a fourth refresh-managed artifact family, opted into by the markers themselves.**

- `discern refresh` regenerates the record lists between the `BEGIN`/`END GENERATED` marker pairs in `<map dir>/_adr/README.md`, from the record files on disk. Each pair (current, superseded) is maintained independently. A README carrying no markers is never touched — adoption is the act of adding them, not a config knob. No `discern.toml` schema change.
- One computation answers "what should the index say": `src/lib/adr_index.ts` recompiles the expected README in memory, stateless, and the refresh writer, `discern status`, and the gate all read it — the recompile-and-compare pattern the agent files established, so the checks can never disagree with the writer.
- Drift surfaces through the established currency channels: `status` reports `data.stale_adr_index` advisorily; `discern done` refuses at the `adr_index` fail-fast precondition. Stale blocks with the `discern refresh` remedy and a capped diff. A record the derivation cannot title (its first heading lacks the record number) also blocks, naming the file — a refresh cannot heal it, and letting it pass would let the index silently rot around it.
- Fresh installs get the index: the setup skeleton's ADR README (and the `discern-write-adr` skill's identical skeleton copy) ships the current-records markers with an empty list that renders as a formatter fixed point, so a new project's first gate run has nothing to refuse.
- This repo unifies onto the shipped path. The codegen step is deleted; `discern refresh` maintains the repo's own index; `tests/adr_index_test.ts` remains as the thin proof-it-bites layer over the shipped core plus the live-repo completeness run.

## Consequences

- A project that adopts the discipline gets an index that maintains itself and cannot silently drift — and never notices the machinery unless it looks. An existing install without markers observes no change at all.
- Exactly one implementation of index rendering and maintenance exists, exercised by every project including this one; a regression here fails this repo's own gate.
- The refresh envelope grows `data.adr_index_written`, the status payload `data.stale_adr_index`, and the closed failed-stage set `adr_index` — each addition forced through its satellites (remedy hint, schemas, atlas) by the existing forcing functions.
- The record-title contract (`# ADR NNNN: <title>`) is now enforced wherever the markers are present; projects with free-form headings must fix the heading or forgo the index.
- The superseded list keys off the `_superseded/` layout this repo uses; the shipped skeleton teaches supersede-in-place and therefore ships only the current-records pair. A project adopting the archive layout adds the second pair.

## Alternatives considered

- **A `discern.toml` toggle.** Rejected: the markers already carry the intent unambiguously, per-file, with zero schema surface — and schema changes were owned by a concurrent launch branch.
- **Injecting the index into any ADR README automatically.** Rejected: rewriting authored prose uninvited breaks the ownership contract; opt-in by markers keeps refresh's writes inside declared regions.
- **Advisory-only (status), no gate refusal.** Rejected: invisible rot is the recorded incident class; an advisory nobody reads is how four records went unlisted.
- **Keeping the repo's codegen step alongside the shipped path.** Rejected: two implementations of one artifact drift apart, and the dogfooded copy would stop proving the shipped one.
