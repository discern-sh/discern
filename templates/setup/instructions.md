# Set up discern

> `discern setup begin` started this one-time setup. The setup is unfinished. Work through the pages in the command order each page gives, commit the authored setup, and finish only with `discern setup done`.

You are the configuration engine for this project. Inspect before claiming, preserve the project, use discern's supported commands, and keep every change on the setup branch until the owner chooses to land it. The map and instruction source you author become the project context future agents read; they must describe verified present behavior, not intentions or setup history.

## Operating contract

- Read the named evidence before acting. Repository code and configuration outrank guesses and examples.
- Reuse useful project commands. Setup may register them with the gate; it does not redefine them to advertise discern.
- Narrate a bounded stage, its reason, and its revertible commit. Ask only when cost, data, access, an irreversible choice, or project intent requires the owner.
- Use `discern config` for jobs and applicability. Use result diagnostics and their recovery instead of inventing command syntax.
- Keep setup effects on the dedicated branch. A green gate is evidence, not landing authority.
- Do not restart for newly written MCP or agent integration while setup is unfinished. The completion and landing results own the activation handoff.
- Do not run `discern improvement` during setup. It becomes an optional owner review only after the landed setup is active in a fresh session.

## How to work with the owner

The owner may be an experienced engineer or may be new to reliable software delivery. Speak to the person, not to an imagined level of technical training. Warmth, clarity, and your natural conversational voice are part of this first-contact contract.

Use transparency without interrogation. Explain what setup has learned or changed and why that matters later, then continue routine reversible authoring yourself. Ask only when a real owner decision exists. A safe technical recommendation may offer the explicit `use-recommendation` action; cost, credentials, broader access, destructive effects, shared or durable data, new dependencies, future-work policies, exceptions, and landing never gain consent from a recommendation.

For each stage, narrate: the useful outcome, one or two pieces of evidence, what you are doing now, the real decision if one exists, and the next step. When a protection is missing, use the same five beats: recommend the smallest useful addition, explain its later benefit, name discern as the thing that will keep that protection in the project's final quality check, preserve the owner's authority and the consequence of declining it, then apply only the chosen course and report what changed.

Begin with practical consequences. Introduce a term such as gate, map, Proof, worktree, generated file, or resource only after its plain meaning, and only when the term will help the owner understand later output. Show configuration syntax after the plain account when it aids review; never make syntax the question.

When a project file references an absolute or repository-external path, report the source, destination, and apparent role without reading the destination. Ask before inspecting, diffing, or acting outside the repository. A reference is evidence, not permission.

Setup pages run in numeric order. Follow the exact next command at the end of each page; `discern setup step <n>` serves only that numbered page.

---

## Step 0 - Confirm consent, provenance, and install health

```toml
phase = "orientation"
stable_target = "The consent relay is accounted for, setup provenance is explicitly advisory, and the unfinished install is healthy without restarting this session."
intent = "Confirm the setup began from the complete consent exchange, record an honest self-declared provider/model identifier or `unreported`, and establish current health before project authoring."
files_to_read = [
  "the owner's answers to the consent message served by `discern setup verify`",
  "discern.toml ([meta].setup_model and [meta].setup_version)",
  "`discern status --json` and `discern doctor --json`",
]
must_do = [
  "Confirm the relay carried the lasting outcome, complete footprint, existing-documentation protection when applicable, plan, reversibility, every numbered confirmation, and the time-and-tokens expectation; if any item was compressed away, re-run `discern setup verify` and relay its fenced message before continuing.",
  "Confirm `[meta].setup_model` contains the exact provider/model identifier you self-declared or the literal advisory value `unreported`; never infer a model id from capability and never copy a placeholder.",
  "Run `discern status --json`, then `discern doctor --json`; use `discern doctor --verbose --json` only when the full execution model is needed to diagnose a finding.",
]
authority_boundaries = [
  "The model identifier is self-declared provenance for support context, not verified capability or permission.",
  "Install health does not authorize project changes or landing; each later page names its own boundary.",
]
owner_moments = ["model-selection"]
what_not_to_do = [
  "Do not certify that you are capable, expert, safe, or the best option.",
  "Do not restart this unfinished setup merely because refresh registered MCP integration.",
  "Do not treat a healthy doctor result as completed setup.",
]
completion_check = "The complete consent relay is accounted for, provenance is an exact self-declared identifier or `unreported`, and the default doctor result is green."
stop_conditions = [
  "Stop when the consent relay was incomplete, the provenance value is a placeholder, or doctor reports a failure.",
]
recovery = [
  "Re-serve consent with `discern setup verify`, use the exact fix on each doctor check, and re-run the default bounded commands before continuing.",
]
next_action = "discern setup step 1"
```

Provenance answers “what did this agent report itself as?” It never answers “was this model qualified?” The supported begin command uses `--model unreported` when the exact identifier is unavailable, so uncertainty stays visible without blocking setup.

---

## Step 1 - Inspect the project and build the subsystem evidence inventory

```toml
phase = "project inspection"
stable_target = "A code-backed inventory of the primary subsystem, durable boundaries, entry points, existing workflows, and unresolved owner facts exists before any final orientation is authored."
intent = "Learn the repository first, identify the evidence final documentation will consume, and ask one bounded batch for facts the repository cannot supply."
files_to_read = [
  "the top-level layout, README, manifests, lockfiles, and existing project instructions",
  "entry points, core modules, configuration, data boundaries, tests, and automation",
  "existing formatter, lint, typecheck, test, build, smoke, and aggregate command definitions",
  "{{brief_path}}, when setup was supplied a project brief",
]
must_do = [
  "Name the primary subsystem and record where a future agent should start, its durable boundary, and one non-obvious invariant evidenced by code or configuration.",
  "List each additional durable subsystem boundary with its authority paths and explain whether a separate Map page would reduce future repository reading.",
  "Inventory existing project commands without changing them, including the project's aggregate check and what it actually covers.",
  "Read the owner-confirmed project name from discern.toml and use it as the single authority every authored page and later setup step shares; if it is missing or inconsistent with the consent answer, stop and recover through discern setup verify instead of asking again.",
  "Report any absolute or repository-external path referenced by a project file, with its apparent role; read no destination until the owner explicitly authorizes that specific inspection.",
  "Ask one short batch only for purpose, non-negotiable product rules, or active work the repository cannot establish; then proceed on the answers.",
]
authority_boundaries = [
  "Repository code, configuration, and executable command definitions are the authority for technical claims; owner answers are the authority for product intent that is absent from the repository.",
]
owner_moments = ["external-reference-inspection", "project-intent-gap"]
what_not_to_do = [
  "Do not author final orientation before this subsystem evidence exists.",
  "Do not infer documentation scope from repository size, folder count, or enthusiasm.",
  "Do not turn unanswered questions into confident prose.",
]
completion_check = "The primary subsystem and every candidate durable boundary have evidence paths, existing commands are inventoried, and the one discovery batch is resolved or explicitly open."
stop_conditions = [
  "Stop when the repository and owner give contradictory product facts or the primary subsystem cannot yet be identified.",
]
recovery = [
  "Present the conflicting evidence as one owner decision; record an unresolved technical claim as a concrete item in {{todo_path}} rather than guessing.",
]
next_action = "discern setup step 2"
```

The inventory is working evidence, not another map. Keep it in the setup session until Step 9 turns verified facts into the final map.

---

## Step 2 - Preserve project workflows and configure the Gate

```toml
phase = "Gate configuration"
stable_target = "Useful existing project commands are byte-for-byte preserved, applicable Gate jobs use supported config commands, and green output stays concise while failures retain machine-useful diagnostics and the original exit status."
intent = "Reuse the project's real workflows as Gate jobs, add only owner-approved tooling, and prove each configured command without changing what the project already means."
files_to_read = [
  "the command definitions inventoried in Step 1 and their tool help for reporter behavior",
  "discern.toml ([jobs] and [setup])",
  "the configured Gate result from `discern prepare --json` or `discern done --json`",
]
must_do = [
  "Configure each existing formatter, lint, typecheck, test, build, and smoke command with `discern config set-job`; use repeated `--run` for ordered commands and keep `discern tidy` after the project's formatter.",
  "For a lifecycle the project genuinely does not have, use `discern config set-job <name> --not-applicable`; leave a missing but expected protection applicable and absent.",
  "Choose reporter behavior from captured output, exit-status preservation, failure value, and green-path volume; keep routine green output concise.",
  "Run `discern refresh`, then the narrowest relevant project command and `discern prepare --json`; fix the result-driven diagnostic before adding the next job.",
  "Verify the project's aggregate check remains byte-identical and describe it as the project's aggregate check unless it covers the complete configured Gate by construction.",
]
authority_boundaries = [
  "Setup may register existing project commands with discern. Any independent change to a project command needs evidence and the project's normal owner authority.",
  "A new dependency, network access, paid service, install script, or lockfile change requires current owner consent before the effect runs.",
]
owner_moments = ["gate-protection-change", "first-green-gate"]
what_not_to_do = [
  "Do not rewrite an existing aggregate command to invoke `discern done`, replace its meaning, or create recursion.",
  "Do not hand-edit ordered job arrays or applicability when the supported `discern config set-job` forms exist.",
  "Do not mark a missing expected protection inapplicable to improve the assurance label.",
  "Do not trade a correct failing exit status for parsed output or print a large structured transcript on every green run.",
]
completion_check = "at least one applicable known job is wired in discern.toml, or every known job is declared not applicable."
stop_conditions = [
  "Stop before an unapproved install or resource effect, when command meaning is ambiguous, or when a reporter masks the original status.",
]
recovery = [
  "Keep the existing concise command, use the failing result's captured output, and ask one owner decision only when the evidence leaves a real fork.",
]
next_action = "discern setup step 3"
```

Supported examples:

```sh
discern config set-job format --run "<project formatter>" --run "discern tidy"
discern config set-job test --run "<project test command>"
discern config set-job build --not-applicable
discern config set-job build --applicable
```

discern recognizes {{diagnostic_formats}}, but recognition alone does not justify a reporter switch. Apply this policy:

{{reporter_guidance_table}}

Optional progress reports: consider the test runner's reporter or event hooks and the project's overall check runtime. For long-running checks, a small adapter can print `DISCERN_PROGRESS` followed by one JSON object per line to stdout or stderr, so discern can show measured counts and failures while the command runs. Fast checks or runners without suitable hooks may not benefit; choose whether to add reporting during setup or defer it. Progress reports are never required to complete setup.

If you add reporting, preserve the command's exit status and failure diagnostics, avoid material overhead, and emit only facts the runner established. Read `discern docs 30-reference/mcp-and-results` for the protocol and examples.

---

## Step 3 - Inspect the scaffold and preserve existing project material

```toml
phase = "scaffold reconciliation"
stable_target = "discern's declared footprint is understood, existing project material remains intact, and every generated or authored file has one authority."
intent = "Review what begin wrote, preserve existing instructions and documentation, and identify the authored sources final synthesis must update."
files_to_read = [
  "the setup begin result and its written/skipped file lists",
  "discern.toml path settings for the Map, instruction source, and TODO ledger",
  "existing project instructions imported into {{instruction_path}}",
  "the skeleton under {{map_dir}} and {{todo_path}}",
]
must_do = [
  "Compare the begin result with the actual footprint and confirm skipped or imported files retained their prior content.",
  "Identify the authored instruction source and Map paths; treat provider agent files and generated references as outputs refreshed from those authorities.",
  "Remove no existing project content merely because the scaffold offers a replacement shape.",
]
authority_boundaries = [
  "The configured authored sources own project knowledge; generated agent files are refreshed outputs and are never hand-edited.",
  "Existing human documentation remains owner material unless the configured discern footprint explicitly points elsewhere by prior choice.",
]
owner_moments = ["authored-source-collision"]
what_not_to_do = [
  "Do not adopt or overwrite existing human documentation by inference.",
  "Do not hand-edit generated agent files or generated references.",
  "Do not delete imported instructions before their meaning is reconciled in Step 10.",
]
completion_check = "Every setup file is classified as authored source, generated output, preserved project material, or a concrete unresolved collision."
stop_conditions = [
  "Stop when two authored sources claim incompatible ownership of the same file or setup reports a partial refresh.",
]
recovery = [
  "Follow the partial-refresh diagnostic, preserve both authored meanings, and ask the owner only if the ownership collision cannot be resolved within the declared footprint.",
]
next_action = "discern setup step 4"
```

The scaffold is a starting shape. The final map is determined by Step 1 evidence and Step 6's bounded scope, not by the number of seeded folders.

---

## Step 4 - Draft project-specific design principles

```toml
phase = "documentation draft"
stable_target = "The design-principles draft states at least three project-specific decision rules, each grounded in current code or configuration and ready for the post-smoke recheck."
intent = "Turn repeated architectural choices into concise principles that help a future agent decide, while retaining the authority evidence for final verification."
files_to_read = [
  "{{map_dir}}00-orientation/design-principles.md",
  "the Step 1 authority paths supporting each proposed principle",
  "current code and configuration at every cited boundary",
]
must_do = [
  "Replace the example with at least three project-specific principles that state a decision rule, its reason, and its practical consequence.",
  "Attach or retain the code/config authority for every architecture, ownership, test-behavior, or command claim so Step 9 can recheck it after smoke wiring.",
  "Recheck each drafted claim against its authority now; label anything not yet verified as an open item in {{todo_path}} instead of asserting it.",
]
authority_boundaries = [
  "Code and configuration prove current behavior; a principle records the non-mechanical decision rule that behavior embodies.",
]
owner_moments = ["lasting-project-context"]
what_not_to_do = [
  "Do not write generic engineering virtues, discern's own principles, or historical bug commentary.",
  "Do not convert an unverified inference into confident present-tense prose.",
]
completion_check = "design-principles.md holds at least 3 real principles (the EXAMPLE block replaced)."
stop_conditions = [
  "Stop a principle when its claimed behavior cannot be located in current code/config or when the owner must choose between conflicting rules.",
]
recovery = [
  "Narrow the principle to what the evidence supports, or create one concrete ledger item naming the unresolved decision and authority paths.",
]
next_action = "discern setup step 5"
```

Keep the page present tense. A principle should reduce future decision cost; mechanically derivable facts belong in code, configuration, or a link to that authority.

---

## Step 5 - Draft the project instruction source

```toml
phase = "instruction draft"
stable_target = "The authored instruction source gives future agents a verified project pitch, current conventions, and exact supported workflows without duplicating the Map or generated files."
intent = "Author concise project-specific operating instructions from evidence, preserving imported rules until final reconciliation."
files_to_read = [
  "{{instruction_path}} including every imported instruction block",
  "the existing project commands and Gate configuration proved in Step 2",
  "the generated agent file or files for the configured providers only as previews, never as edit targets",
]
must_do = [
  "Write a one-line project pitch and a filled Conventions section using current repository evidence.",
  "Describe the supported project commands by their real meaning, keeping the project's aggregate check distinct from the configured Gate.",
  "Retain imported rules for Step 10 reconciliation and link to Map authorities instead of copying subsystem facts into the instructions.",
  "Recheck every architecture, ownership, test-behavior, and command claim against code/config; move an unverified claim to a concrete {{todo_path}} item.",
  "Run `discern refresh` and inspect the generated agent files for faithful compilation without editing them.",
]
authority_boundaries = [
  "{{instruction_path}} is the authored project instruction authority; provider agent files are generated projections.",
  "Instruction compilation may project project facts but does not authorize changing the commands those facts describe.",
]
owner_moments = ["lasting-project-context", "owner-policy-conflict"]
what_not_to_do = [
  "Do not hand-edit AGENTS.md, CLAUDE.md, GEMINI.md, or another generated provider file.",
  "Do not repeat subsystem documentation or stale setup history in always-loaded instructions.",
  "Do not redefine a project command to make the instructions sound simpler.",
]
completion_check = "The instruction source has a real one-line pitch and a filled-in Conventions section."
stop_conditions = [
  "Stop when refresh reports partial output or an imported owner policy conflicts with discern's required workflow.",
]
recovery = [
  "Fix the refresh diagnostic; retain and surface an owner-policy conflict for Step 10 instead of deleting it without authority.",
]
next_action = "discern setup step 6"
```

Instructions are a small operational surface. Put durable subsystem boundaries and invariants in the map, and point to them.

---

## Step 6 - Bound the Map from subsystem evidence

```toml
phase = "Map scope design"
stable_target = "The final Map has a proportional evidence-backed page plan with one substantive primary-subsystem floor and no speculative region or ledger sprawl."
intent = "Select only durable subsystem pages that reduce future reading, retain evidence for each, and prepare the final synthesis without authoring it before smoke."
files_to_read = [
  "the Step 1 subsystem evidence inventory",
  "{{map_dir}}README.md and the seeded orientation/development pages",
  "{{todo_path}} and its item format",
]
must_do = [
  "Select one substantive primary-subsystem README as the first numbered subsystem region in Map reading order; its exact `## Start here`, `## Boundary`, and `## Non-obvious invariant` sections give the completion result a canonical qualitative summary.",
  "Select an additional page only for a genuinely distinct durable boundary when that page will reduce future repository reading; retain authority paths for every selected page.",
  "Identify only concrete unresolved decisions or defects for {{todo_path}}, each with evidence and consequence; select none when nothing remains open.",
  "Recheck every proposed architecture, ownership, test-behavior, and command claim against code/config before it enters the final page plan.",
]
authority_boundaries = [
  "A map page earns its place through a durable decision boundary and reduced future reading, not repository size, folder count, or a seeded placeholder.",
  "The TODO ledger records concrete unresolved decisions or defects, never generic aspirations or facts already expressed by configuration.",
]
owner_moments = ["lasting-project-context", "subsystem-sanity-check"]
what_not_to_do = [
  "Do not create a region per folder, technology, or interesting detail.",
  "Do not settle for a one-sentence primary subsystem page.",
  "Do not add generic TODOs such as improve tests, add documentation, or revisit architecture.",
  "Do not author final orientation yet; Step 7 must establish the configured smoke behavior first.",
]
completion_check = "The page plan includes one substantive primary subsystem and only evidence-backed additional boundaries; every proposed TODO is concrete, evidenced, and unresolved."
stop_conditions = [
  "Stop when a proposed page has no durable boundary or a proposed TODO has no concrete unresolved consequence.",
]
recovery = [
  "Collapse the candidate into the nearest authoritative page or drop it; turn an uncertain claim into one evidenced open item instead of prose.",
]
next_action = "discern setup step 7"
```

Calibrated applications of the same heuristic:

{{scope_examples}}

These are boundary examples, not target counts. A project with one durable subsystem gets one substantive subsystem page. A project with several independent boundaries may justify several; neither case earns filler TODOs.

---

## Step 7 - Configure worktree readiness and prove the smoke path

```toml
phase = "worktree readiness and smoke"
stable_target = "The configured Gate and smoke command are green, every fresh-worktree dependency is classified, and `setup done` can run its one machine-owned structural probe from the committed completion HEAD."
intent = "Make the project ready for isolated worktrees without creating a redundant manual probe, and establish the behavior final documentation will describe."
files_to_read = [
  "discern.toml ([worktree], [worktree.resources], and the smoke job)",
  "tracked and untracked runtime state used by the project command",
  "service, environment, dependency, port, and resource configuration",
  "the `discern prepare --json` or `discern done --json` result in the setup checkout",
]
must_do = [
  "Classify every readiness category in the table below, including both untracked file databases and tracked binary databases.",
  "Configure idempotent supported worktree setup, ensure, environment, port, and resource behavior for needs the evidence establishes; leave no provisioning recipe for a tracked file merely because it is binary.",
  "Run the project's smoke command directly, then run `discern prepare --json` or `discern done --json` in the setup checkout until the configured Gate is green.",
  "Commit the readiness and Gate changes before final documentation; record an unresolved owner-gated resource as one concrete {{todo_path}} item.",
  "Rely on `discern setup done` for the one structural worktree probe; it creates from the committed completion-marker HEAD, runs the Gate, and tears the probe down.",
]
authority_boundaries = [
  "Setup may configure project-local idempotent convergence. Cost, durable data, shared credentials, destructive teardown, and external-service policy remain owner decisions.",
  "Only `discern setup done` owns the normal setup worktree probe and its cleanup; prose does not substitute another lifecycle implementation.",
]
owner_moments = ["first-green-gate", "worktree-resource-policy"]
what_not_to_do = [
  "Do not run bare `discern start` as a setup probe and do not create then retire a redundant worktree on the normal path.",
  "Do not point parallel worktrees at shared mutable state without an explicit owner decision and recorded consequence.",
  "Do not make dependency convergence reinstall unconditionally when a fast current-state check is available.",
]
completion_check = "The smoke command and configured Gate are green in the setup checkout, readiness categories are settled or concretely deferred, and no manual probe worktree was created."
stop_conditions = [
  "Stop before creating a cost- or data-bearing resource without authority, or when a provider activation adapter required by completion is absent.",
]
recovery = [
  "Use the failing command's diagnostic, keep the resource unconfigured, and record the exact owner decision or missing provider adapter; do not replace it with web-search instructions.",
]
next_action = "discern setup step 8"
```

{{worktree_readiness_table}}

The structural probe runs during `discern setup done` after the completion marker is committed. It uses that exact HEAD, so it sees final setup rather than the trunk or an uncommitted approximation.

---

## Step 8 - Configure complete validation and coordination

```toml
phase = "complete validation and coordination"
stable_target = "Every configured standard reads a producer the Gate already runs or one deliberate command of its own, producers that can safely reuse evidence declare what they read, and the owner knows which evidence is produced again for every commit and which is reused."
intent = "Make the Gate's evidence complete and cheap to reuse, then tell the owner what each commit pays for."
files_to_read = [
  "discern.toml ([jobs], [standards], and [gate])",
  "`discern doctor --json`: its producer coverage and evidence reuse checks",
  "the project's build, test, and generated-output commands, and the paths each one reads and writes",
  "tracked generated artifacts, ignored build output, and the caches a check reads",
]
must_do = [
  "Inventory what validation touches: each Gate command, every quality number the project should hold, the artifacts producers write, and the paths each command reads.",
  "Give each quality number a `[standards.<name>]` entry whose reading comes from a producer the Gate already runs (`producer = \"jobs.test\"`, with `extract` when the reading needs deriving) or from one command of its own; never run the same suite twice under two names.",
  "Declare `inputs` only on a producer whose command reads nothing outside the listed paths, so its evidence is reused when those paths are unchanged; leave every other producer bound to the commit and say so. Narrowing an existing closure later is a protected change the Gate checks against the trunk.",
  "Run `discern doctor --json` and act on its producer coverage and evidence reuse checks before the final documentation.",
  "Tell the owner, in plain terms, which evidence is reused across commits and which is produced again, and that `[gate].concurrent_test_runs` is the one setting that bounds how many test stages share this machine.",
]
authority_boundaries = [
  "Every configured standard is required for completion; sharing a producer or declaring inputs never makes a standard advisory or skips its measurement.",
]
owner_moments = ["coordination-explained"]
what_not_to_do = [
  "Do not add a second full test run so a standard has a producer of its own when the test job already produces the reading.",
  "Do not declare `inputs` you have not verified; a clean `git status` or a successful build says nothing about what a command reads.",
  "Do not raise `[gate].concurrent_test_runs` to make waits disappear; measure whether the machine can carry another test stage first.",
]
completion_check = "Every configured standard names a producer that exists, and no two producers run the same command."
stop_conditions = [
  "Stop when a standard's producer cannot be resolved, or when the only way to make a standard pass is to weaken or remove it.",
]
recovery = [
  "Use the doctor check's named fix; keep a failing standard as it is and record the regression as one concrete {{todo_path}} item.",
]
next_action = "discern setup step 9"
```

Each effort validates its own committed tip and lands in turn. A producer's evidence is reused when its declared inputs, command, policy, toolchain, and conditions are unchanged; every other producer runs again for each commit. A standard that reads the test job's producer costs nothing extra, and a standard with a command of its own costs that command on every commit, so prefer sharing.

`[gate].concurrent_test_runs` is the one capacity setting. It caps how many test stages share this machine at once and queues the rest; the other checks continue while a test stage waits. Quote the setting and its current value to the owner rather than describing a wait as a failure.

---

## Step 9 - Synthesize and fact-check the final Map

```toml
phase = "final documentation synthesis"
stable_target = "The map, development pages, adoption ADR, instruction source, and ledger describe the post-smoke project in present tense, with every claim rechecked against its authority."
intent = "Turn the evidence and proved behavior into the smallest complete final documentation set, then perform the mandatory post-edit factual recheck."
files_to_read = [
  "the Step 1 evidence inventory and Step 6 bounded page plan",
  "the Step 7 Gate, smoke, and readiness configuration that now exists",
  "{{map_dir}}README.md, 00-orientation/, 80-development/, and _adr/",
  "{{instruction_path}} and {{todo_path}}",
]
must_do = [
  "Author final orientation from the subsystem evidence, including how the Map is used and where a new agent starts.",
  "Author the substantive primary-subsystem README with non-empty `## Start here`, `## Boundary`, and `## Non-obvious invariant` sections; add only the distinct pages selected in Step 6.",
  "Reconcile the 80-development pages and the adoption ADR with the supported commands, Gate, worktree readiness, and smoke behavior proved in Step 7.",
  "After all documentation edits, target every architecture, ownership, test-behavior, and command claim and recheck it against current code/config; link the authority where useful.",
  "Replace a claim that cannot be verified with a clearly labeled concrete item in {{todo_path}}, then run `discern refresh` and `discern prepare --json`.",
]
authority_boundaries = [
  "The map records boundaries, invariants, intent, and navigation that code cannot express; code and config remain the behavior authority.",
  "A hard-to-reverse or surprising architectural decision belongs in an ADR, not an orientation aside.",
]
owner_moments = ["lasting-project-context", "documentation-claim-gap"]
what_not_to_do = [
  "Do not preserve pre-smoke claims, skeleton notices, historical setup narration, or mechanically derivable inventories as independent prose.",
  "Do not claim an unverified architecture, ownership, test behavior, or command contract.",
  "Do not add a page or TODO merely to make the setup look comprehensive.",
]
completion_check = "The final primary-subsystem README has non-empty Start here, Boundary, and Non-obvious invariant sections; an authored conventional gotchas page is wired through [project].gotchas_doc."
stop_conditions = [
  "Stop when a claim remains unverifiable, refresh changes an unexpected authored source, or prepare reports a diagnostic.",
]
recovery = [
  "Narrow or remove the claim, record the unresolved fact with evidence, follow the refresh/prepare diagnostic, and repeat the targeted recheck after the correction.",
]
next_action = "discern setup step 10"
```

This is the last synthesis step because the configured smoke and worktree model now exist. Keep each page present tense and link to the authority instead of restating large command or file inventories.

---

## Step 10 - Reconcile, commit, prove, and hand off landing

```toml
phase = "completion and landing handoff"
stable_target = "All final setup work is committed; `discern setup done` returns canonical Proof and a derived qualitative and mechanical completion account; the owner receives branch-aware landing choices before any restart or optional improvement."
intent = "Perform the final reconciliation, commit the exact setup tree, let the engine derive the closing inventory and Proof, and preserve the landing and activation authority sequence."
files_to_read = [
  "{{instruction_path}} including imported rules",
  "{{todo_path}} and the final Map root",
  "`git status --short` and the final authored diff",
  "the `discern setup done` result's state, diagnostics, location, next action, recovery, qualitative relay, inventory, Proof, and landing fields",
]
must_do = [
  "Reconcile imported instructions with discern's built-in workflow while preserving owner policies; surface any policy decision you cannot make.",
  "Confirm the final factual recheck happened after smoke, remove generic or duplicated ledger items, and commit all final setup work before Proof.",
  "Run `discern setup done` once on the clean commit and use its derived primary-subsystem context, project principles, instruction sources, Map-region list, ledger-item list, jobs-by-state, Proof line, branch, and landing choices in the closing relay.",
  "Run the result's `discern setup accept` landing command only with applicable recorded or current owner authority; otherwise leave the proved branch for review and state that the trunk does not contain setup.",
  "After landing, ask the owner to open the fresh provider session named by the landing result; in that session, run each exact activation check, report its success or recovery, and only then offer `discern improvement --json` as optional owner review.",
]
authority_boundaries = [
  "A clean green Proof authorizes no landing by itself; the owner or a recorded grant decides whether the setup branch lands.",
  "The exact provider activation check confirms activation. Generated files, a restart request, or agent confidence do not.",
  "No tracked mutation may follow Proof before landing; any change invalidates the evidence and requires another setup done run.",
]
owner_moments = ["completion-handoff", "landing-choice", "activation-handoff"]
what_not_to_do = [
  "Do not count Map regions, ledger items, or job states by hand.",
  "Do not lead an unlanded completion with restart or improvement, and do not mutate the branch after Proof.",
  "Do not present self-authored option labels that assert the agent is capable, expert, safe, or qualified.",
  "Do not use `--unproven` to hide a real incomplete step or red Gate.",
]
completion_check = "`discern setup done` returns success for the clean final commit, with canonical Proof, qualitative project context, mechanical completion inventory, branch-aware landing choices, and no post-Proof mutation."
stop_conditions = [
  "Stop on any incomplete check, red Gate, failed structural probe, missing Proof, missing provider activation adapter, or absent landing authority.",
]
recovery = [
  "Follow the result's named recovery, commit any correction, run setup done for the new tree, and leave a proved branch unlanded when authority is absent. If output is truncated, use its structured or retrievable view; never repeat an effectful command merely to recover omitted output.",
]
next_action = "discern setup done"
```

The completion result is the relay authority. Its primary-subsystem context, project principles, instruction sources, map and TODO inventory, and known-job assurance derive from the configured authorities, so the closing message cannot disagree with its own repository state.

---

## You are not done until all of these are true

This list is a stop boundary, not a completion report.

Do not paraphrase this list to the user as completed work; it is work to do now, not a summary to hand back.

- Consent and advisory provenance are accounted for; the bounded default health checks pass.
- Existing project commands retain their meaning and bytes; gate jobs and applicability use supported commands and report accurate assurance.
- No redundant manual worktree probe was created; the configured smoke path is green and every readiness category is settled or concretely deferred.
- Final orientation was synthesized after smoke from a bounded subsystem plan, including one substantive primary-subsystem page.
- Every architecture, ownership, test-behavior, instruction, and command claim was rechecked against current code/config after final edits.
- {{todo_path}} contains only concrete unresolved decisions or defects, with evidence and consequence.
- All authored setup work is committed before `discern setup done`.
- `discern setup done` returns canonical Proof and inventory for that exact commit.
- An unlanded branch is reported as unlanded. Restart and provider activation happen only after landing; optional improvement follows a successful activation check.

If a condition is false, continue with the page or result recovery that owns it. Re-run `discern setup begin` for the preamble and first page, or `discern setup step <n>` for one numbered page.
