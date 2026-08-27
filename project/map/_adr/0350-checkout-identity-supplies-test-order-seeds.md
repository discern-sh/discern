# ADR 0350: Checkout identity supplies explicit test-order seeds

**Status**: accepted. Extends worktree resources from [ADR 0025](0025-worktree-resources.md), canonical-set parity from [ADR 0051](0051-canonical-set-parity.md), parallel-safe tests from [ADR 0068](0068-parallel-safe-tests-env-cwd-injection.md), and the clock, jitter, and entropy boundaries from [ADR 0347](0347-clock-scheduler-and-jitter-are-explicit-capabilities.md) and [ADR 0348](0348-secure-entropy-is-a-webcrypto-capability.md).

## Context

The suite runs test modules in parallel, but two audit tests still depended on earlier tests in the same module populating shared collections. Seeded shuffle exposed both. A bare Deno `--shuffle` does not print the chosen seed, so a later failure diagnostic cannot provide a reproducible order. A wall-clock or random seed would rotate orders but would make iteration and remote reproduction unstable.

The linked worktree already has stable structured identity and a POSIX `cksum` derivation for its port band. One effort keeps one branch for its whole lifetime, so branch state can hold one reproducible order while different efforts exercise different orders. The main checkout also has meaningful coordinates, but identity resolution previously refused it. A test runner, continuous-integration checkout, or resource consumer on the trunk therefore could not obtain the same fields.

Test order is deterministic jitter, not secure entropy. It must not read the clock, consume the secure-entropy capability, or change when the effort gains a commit. The trunk's order must be defined deliberately even though it has no rotating worktree id.

## Decision

Identity belongs to every Git checkout. A linked worktree continues to resolve its id from its process override, configured environment files, or Git worktree metadata. The main checkout derives its id from the sanitized effective trunk branch and preserves the full configured name as its branch. Port, site, database, worktree, and resource handles derive from that checkout id. Start-time port collision avoidance includes the trunk beside live linked worktrees.

`seed` joins the identity-field single source. It is the frozen POSIX `cksum` of the full branch name with no trailing newline. The port remains `17290 + cksum(id) % 2000`; both values therefore use the same structured-state hash family while retaining their separate inputs. A linked worktree's seed is stable for its branch's whole effort. The trunk seed is intentionally constant while `[repository].trunk` is unchanged.

The repository test runner always passes `--shuffle=<seed>` and names the seed before Deno starts. The canary imports the same command builder and forwards every caller argument. A caller may override the order with one explicit `--shuffle=<seed>`; bare `--shuffle` is refused because it cannot be replayed. Status, JSON, Markdown, Model Context Protocol (MCP), and the status resource project checkout identity from the same typed field set.

Seed derivation reads no wall or monotonic clock, scheduling jitter, or secure entropy. It is not an entropy source and must never be used as one.

## Consequences

- Every ordinary suite run probes order independence and prints enough state to replay a red exactly.
- One agent iterates against one order instead of receiving noise on every rerun. Different effort branches rotate the order across the fleet.
- The trunk exercises one constant order. Deliberate alternate-seed runs provide broader probes without making the landing Gate nondeterministic.
- Main-checkout callers can query every identity field and resource handle. Consumers that treated main-checkout identity refusal as a location test must use the explicit checkout location instead.
- A branch-prefix or configured-trunk change changes its corresponding seed. A trunk-name change also changes main-checkout ids and derived handles.
- Resolving the seed adds one checkout-identity read before a suite starts; it adds no per-test work.
- `discern identity --seed` and main-checkout identity are additive public surfaces. No side-project migration is required.

## Alternatives considered

- **Use bare `--shuffle`.** Rejected because Deno does not report the chosen seed and a gate diagnostic would not be reproducible.
- **Use wall time, scheduling jitter, or secure entropy.** Rejected because reruns would change order, deterministic test policy would cross the wrong capability boundary, and secure randomness would be spent without a security need.
- **Derive from the current commit.** Rejected because every commit would change an effort's order and turn ordinary iteration into moving evidence.
- **Use one repository-wide constant.** Rejected because it would catch one order repeatedly and gain no fleet-wide rotation.
- **Store a dedicated test seed in configuration or environment state.** Rejected because branch identity already owns the required lifetime and another setting would duplicate structured state.
