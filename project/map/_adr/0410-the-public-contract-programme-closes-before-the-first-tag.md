# ADR 0410: The public contract programme closes before the first tag

**Status**: accepted on 2026-09-17. Builds on [ADR 0409](0409-public-contracts-split-durable-enforcement-from-session-judgment.md) and [ADR 0208](0208-public-contracts-version-by-schema-major.md).

## Context

The first `v<SemVer>` tag arms the compatibility comparators. From that commit on, every artifact under `schema/` is a promise, and a correction to a frozen name or rule costs a schema major. Before the tag, the owner reviewed the whole contract in one bundle: a hand-written orientation, the findings, the rules for what breaks, and a mechanical digest of the artifacts rendered from `schema/`.

The review found more frozen than the product could promise. The conventions manifest carried private storage layout and verb membership. Output enumerations that engine code only carries were closed, so a new member was a break. The comparators held listing order, refused an optional trailing positional argument, and had no notion of a settling command. Several names and defaults were not the ones the owner wanted to keep for the rest of the major. An adversarial review of the plan tightened the boundaries on the same day. Each correction had to land before the tag, and the corrections depend on one another.

## Decision

The corrections land as one programme of six workstreams, each in its own worktree with its own Proof, in dependency order:

1. **The compatibility policy** ([ADR 0409](0409-public-contracts-split-durable-enforcement-from-session-judgment.md)): the manual states the promise, the map states the mechanism.
2. **The conventions manifest content**: repository facts and the script protocols only.
3. **The result vocabulary**: the frozen definition and error-slug names corrected before they are promised.
4. **The configuration vocabulary**: key names settled by one naming rule, and governing reads that survive a rename so a rename can land.
5. **The command-line grammar**: one spelling per concept, with accepted values recorded in the CLI manifest.
6. **The stability tier, the vocabularies, the comparator semantics, and MCP resources**: `stability: "evolving"` on a result contract; the open and closed vocabulary registries with identity carried by schema metadata; inputs append-only and outputs open or closed by role; positional arguments held by slot; listing order not promised; the resource table enrolled in the MCP manifest; the proof readers and the MCP output boundary accepting an unknown member of an open vocabulary.

Each workstream carries a brief with a definition of done and lands through the ordinary gate. Every rule a workstream adds gets a synthetic fixture in the compatibility guard and a currency assertion against the generated artifacts, so the rule cannot outlive its input.

The digest that supported the review is kept as a generated map page. `deno task codegen` renders the [public contract digest](../_internal/public-contract-digest.md) from the committed artifacts, framed by the generated-inventory policy like the registry atlas, so the whole contract stays readable on one page and the gate holds it current. The hand-written parts of the review stay in the private overlay as history; the decisions they record live in ADR 0409.

## Consequences

- The contract is reviewed as one page rather than eight JSON files, and the page cannot drift: the digest test fails when the committed page differs from the artifacts.
- The programme is the last launch blocker for the contract. After the tag, a correction to a stable member costs a major on the durable tier or a recorded retirement on the session tier.
- The digest is one more generated page under `_internal`, held to the map's prose and structure checks, so a rendering change must keep the page tidy and readable.
- The private review bundle stays useful as history only. The map and the manual carry everything a reader needs now.

## Alternatives considered

- **Land the corrections as one branch.** Rejected: the corrections touch every artifact and depend on one another, and one Proof for all of them would have hidden which change broke what.
- **Keep the digest in the private overlay.** Rejected: it is rendered from public artifacts and answers the question every contract change raises, so it belongs where the gate keeps it current.
- **Tag first and fix under the ratchet.** Rejected: most corrections were renames, and each one would have cost a schema major.
