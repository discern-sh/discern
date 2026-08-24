# ADR 0078: setup steps are stateless machine-readable pages with derived per-step proof

> **Amendments.**
>
> - **Job-model vocabulary ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use gate `capability` / custom `check` → known/custom `job`; the decision and reasoning are unchanged.
> - **[ADR 0322](0322-setup-is-one-bounded-operational-journey.md) — operational page registry:** page identifiers remain stable while a versioned registry owns presentation order and exact continuations. The spine now carries the full operational contract, and human and Markdown renderers project it from the same parsed authority as JSON.
> - **Semantic human moments:** each authored page names canonical owner-moment ids. The parser resolves their complete explanation or decision contract into the prose lane and a compact typed routing projection into the spine. The full sentences appear once, while integrations retain kind, recommendation, options, and the wait boundary. `setup done` also derives the primary subsystem's `Start here`, `Boundary`, and `Non-obvious invariant` sections as a completion predicate and closing handoff.

**Status**: accepted; builds on [ADR 0075](0075-setup-staged-handshake.md) (the staged handshake, stateless derived progress, and the read-only `setup step <n>` re-serve), [ADR 0065](0065-setup-keeps-its-promises.md) (`setup done` is a proven gate), [ADR 0028](0028-result-envelope-and-diagnostics.md) (one result envelope per verb), and [ADR 0041](0041-self-describing-mcp-surface.md) (schema-backed `data`). Reshapes the content of `templates/setup/instructions.md` and the `begin` / `step` / `done` surfaces.

## Context

ADR 0075 split setup into a staged handshake and made progress _derived_, never self-reported. The brief an agent works through, however, stayed a single ~8,000- token prose blob: `setup begin` printed the **whole** nine-step brief up front, `setup step <n>` re-served one step as a raw markdown slice (`extractStep`), and `setup done` proved completion only structurally — no skeleton marker remained and `refresh → doctor → done` was green.

Clean-room runs with no-context agents (the target user) exposed two failure modes the single-blob shape could not reach:

- **The full brief is a context tax and a real liability on smaller-context models.** Eight thousand tokens of instructions land before any repo analysis begins; a weaker model skims, and the rails it most needs are buried.

- **`setup done` proves too little.** The marker check is satisfied by _deleting_ a `<!-- setup fills this -->` sentinel — an agent can clear the marker without meaningfully filling the file and still pass. That shallow compliance ("ran the command, declared victory") is the exact failure discern exists to prevent.

Two constraints bound any fix. **Statelessness** (ADR 0075): setup tracks and records nothing; progress is always re-derived from repo state, never a self-reported "current step." And a **two-lane** finding from the same runs: when behavioral/consent instructions arrived as JSON _fields_, agents treated them as data to summarize and weakened every one ("open warmly" dropped, the model question reworded); the _same_ content as prose was followed faithfully. So structure helps navigation but can _hurt_ compliance — the warm prose is load-bearing, not decorative.

## Decision

**Each setup step becomes a stateless, machine-readable _page_ — a structured spine plus warm prose — served one at a time, and `setup done` proves per-step completion from re-derived repo state.**

1. **Per-step spine, authored in place.** Every `## Step <n>` in `templates/setup/instructions.md` carries a fenced TOML **spine** — `intent`, `files_to_read`, `must_do`, `owner_moments`, `what_not_to_do`, `completion_check`, `next_action` — immediately followed by the existing warm prose as the page body. The spine and the prose are co-located per step. A page parser (`src/shared/setup_pages.ts`) splits the brief into a preamble, the numbered pages, and the closing stop-conditions, validates the spine, and resolves owner moments from `src/shared/setup_experience.ts`.

2. **Two lanes, kept distinct.** The spine is the **machine lane**: navigation, completion proof, and compact owner-moment routing state. The prose is the **human lane**: the full outcome, reason, recommendation, option consequences, owner action, agent wait/proceed behavior, reversibility, and relay. `setup step <n>` renders the prose prominently and carries both lanes under `--json`. Both derive from one moment authority, so the context budget never pays for the complete sentences twice.

3. **`begin` emits the preamble + the first page only.** The operating principles and the "how to work with the user" sections lead; then page 0. Subsequent pages are pulled with `setup step <n>`, chained by each page's `next_action`. The repetition-as-insurance ("you are not done") is spread across pages and the tail-survivable footer instead of front-loaded.

4. **`setup done` evaluates derived per-step predicates.** A small registry (`src/shared/setup_checks.ts`) re-computes, from repo state, that the authoring work each checkable step asked for is evident: `design-principles.md` holds at least 3 principles, the instruction source has a pitch and Conventions section, at least 1 job is wired or applicability is complete, and the primary-subsystem README has `Start here`, `Boundary`, and `Non-obvious invariant` sections. These supplement the marker and final proof transaction. A skipped step fails with a diagnostic naming the unmet check. Each predicate's `describe` matches its page's `completion_check`, tied by a forcing-function test.

The explicit *no*s:

- **No "current step" counter or any setup-time state.** Progress stays derived (ADR 0075). The page parser is pure text→struct; `done`'s predicates read the tree. Nothing records where the agent "is."

- **The completion predicates are conditional on the scaffolded file being present.** They prove "the work the skeleton asked for was done," not "this exact path exists." A project that kept its own `docs/` tree and adapted the steps to it (ADR 0075's existing-docs case) has no file at the skeleton path, so the predicate is N/A — it never punishes a legitimately different structure. The shallow-compliance case it _does_ catch is the common one: the skeleton was laid, its marker cleared, but the content left a stub.

- **The spine is TOML, not YAML/JSON or a bespoke format.** `@std/toml` is already a dependency and the project's idiom; a fenced block per step keeps the authoring single-sourced and renders cleanly when the template is read directly.

## Consequences

- **A weak / small-context agent drives setup one page at a time.** It pays for only the page in hand, knows exactly what the page requires (`must_do`) and how it will be checked (`completion_check`), and is chained to the next page — the rails ChatGPT and Codex both asked for, without the state machine either reached for.

- **Shallow compliance is structurally blocked.** Clearing a marker no longer passes `done` on its own; the derived predicate re-checks the substance. This is the anti-shallow-compliance core, and it cannot be faked for the same reason ADR 0075's progress view cannot — it reads what is on disk, not what the agent says.

- **The warm tone survives the structuring.** Because the behavioral guidance stays in the prose lane, the non-CI-bot voice the brief is careful about is not flattened into field lists — the regression the two-lane finding warned of.

- **More surface to keep coherent.** A page parser, a spine schema, and a check registry are new moving parts. They are held together by the project's existing single-source disciplines: the spine schema lives once in `result_schemas.ts`, the check registry's `describe` is tied to the brief's `completion_check` fields by a parity test, and the parser fails loudly on a malformed spine — so an edit to the brief that breaks a page is caught by the gate, not shipped.

- **The predicates couple to the skeleton's shape.** "≥3 principles" counts the template's headings; the guidance check looks for the `## Conventions` heading and the replaced pitch placeholder. A skeleton restructure that moves those must move the predicate with it — a cost paid down by tests that pin the shipped skeleton to what the predicates read.

## Alternatives considered

- **A parallel structured file (`steps.toml`) beside the prose.** Rejected: it splits one step's authoring across two files that drift, and the prose is the load-bearing lane — co-locating the spine with the prose it summarizes keeps a single edit site per step.

- **Encode the whole step as structured fields, prose included.** Rejected by the clean-room evidence: behavioral/consent instructions delivered as JSON fields were summarized and weakened. The spine carries only navigation and proof; the prose stays prose.

- **Self-reported per-step completion (`setup done --step=N`).** Rejected as ADR 0075 already rejected it — it reintroduces the echo-back failure one altitude down and buys round-trips for no real verification. Derived predicates cannot be faked and cost nothing to re-run.

- **Hard-require the skeleton paths to exist in `done`.** Rejected: it would break the existing-docs project that adapted the steps to its own tree. N/A-on-absent keeps the predicate honest about what it can actually prove without setup-time state.
