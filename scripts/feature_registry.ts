/**
 * The feature registry and the generated feature canon — the product's
 * features and benefits as DATA, rendered into the maintainer canon page the
 * same way the glossary renders from its term registry (ADR 0175, following
 * the discipline of `glossary_registry.ts`).
 *
 * Three consumers:
 *  - `scripts/codegen.ts` renders {@link renderFeatureCanonDoc} into the map's
 *    committed `_internal/feature-canon.md`; a sync test asserts the
 *    committed file equals the generator output, so a feature change that
 *    isn't regenerated fails the gate.
 *  - the enrolment guards (`tests/feature_canon_enrolment_test.ts`) hold every
 *    member of the product's closed sets — verbs, known jobs, stages, config
 *    tables, bundled skills, agent providers — to a claim in this tree, so the
 *    feature account can never lag the product.
 *  - creative, technical, and marketing work reads {@link FEATURE_CANON} (or
 *    the generated page) instead of re-deriving the feature list by hand.
 *
 * Statements whose facts another registry owns interpolate from that single
 * source — the known-job vocabulary from `KNOWN_JOBS`, the stage names from
 * `STAGES`, the provider names from `AGENT_NAMES` — so adding a member updates
 * the canon's prose in the same change.
 *
 * This module lives under `scripts/`, not `src/`: its strings are map prose,
 * whose internal ADR citations the vocab guard rightly bans from the binary's
 * own source tree (ADR 0164), and no part of the shipped binary reads it.
 */

import { join } from "@std/path";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";

/**
 * One node of the feature canon. Depth is resolution: top-level nodes are the
 * pillars, leaves are the finest-grained behaviors, and every cut in between
 * is a legitimate reading of the product.
 */
export interface FeatureNode {
  /** Stable kebab-case id, unique across the whole tree. */
  id: string;
  /** Canonical display name — glossary vocabulary, used identically. */
  title: string;
  /**
   * Marks a node whose statement is value rather than mechanism — an abstract
   * benefit the product delivers, with no single implementation surface.
   */
  kind?: "benefit";
  /** What it is or does: one or two plain sentences, present tense. */
  what: string;
  /** What it buys the user — the benefit, stated factually. */
  why?: string;
  /**
   * Explicit claims on closed-set members, written `set:member` — e.g.
   * `verb:done`, `job:test`, `stage:fix`, `config:standards`,
   * `skill:discern-cure-a-bug`, `agent:codex`. The enrolment guard holds every
   * live member to a claim here (or a recorded deliberate absence), and every
   * claim to a live member.
   */
  surfaces?: readonly string[];
  /** Finer-resolution children. */
  children?: readonly FeatureNode[];
}

/** The closed sets the canon claims members of. */
export const SURFACE_SETS = [
  "verb",
  "job",
  "stage",
  "config",
  "skill",
  "agent",
] as const;
export type SurfaceSet = (typeof SURFACE_SETS)[number];

/** `a`, `b`, and `c` — backticked names joined with an Oxford conjunction. */
function codeList(names: readonly string[], conjunction: string): string {
  const coded = names.map((n) => `\`${n}\``);
  if (coded.length <= 1) return coded.join("");
  if (coded.length === 2) return coded.join(` ${conjunction} `);
  return `${coded.slice(0, -1).join(", ")}, ${conjunction} ${coded.at(-1)}`;
}

/**
 * The canon. Pillar order is narrative order — the gate first, foundations
 * last; the renderer preserves it. Every pillar states its `why`.
 */
export const FEATURE_CANON: readonly FeatureNode[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "gate",
    title: "The quality gate",
    what:
      "One command — `discern done` — runs the project's full quality check: the declared jobs by stage, any scope gates the change woke, and the standards, with every job labeled and every failure carrying the command that produced it.",
    why:
      "The repo, not the agent, decides what done means. An agent's confidence has no vote; the gate's verdict is a command result.",
    surfaces: ["verb:done", "config:jobs", "config:gate"],
    children: [
      {
        id: "jobs-table",
        title: "Declared jobs",
        what:
          `A project declares its commands once, under \`[jobs]\`. The known names ${
            codeList(Object.keys(KNOWN_JOBS), "and")
          } derive their stage; a custom \`[jobs.<name>]\` table declares one, with an optional \`provides\` label.`,
        why:
          "Every agent and every human runs the same commands, read from one file.",
        children: [
          {
            id: "job-format",
            title: "format",
            what:
              "The fix-stage job: a formatter or codemod that may rewrite files. It runs first and serially, so mutations never race read-only checks.",
            surfaces: ["job:format"],
          },
          {
            id: "job-build",
            title: "build",
            what:
              "Produces the artifacts later stages read — compile, bundle, codegen.",
            surfaces: ["job:build"],
          },
          {
            id: "job-lint",
            title: "lint",
            what: "Read-only static analysis at the check stage.",
            surfaces: ["job:lint"],
          },
          {
            id: "job-typecheck",
            title: "typecheck",
            what: "Read-only type checking at the check stage.",
            surfaces: ["job:typecheck"],
          },
          {
            id: "job-test",
            title: "test",
            what:
              "The test suite, with an optional per-job `timeout` for a slow suite.",
            surfaces: ["job:test"],
          },
          {
            id: "job-smoke",
            title: "smoke",
            what:
              "A fast, side-effect-light readiness check: the app boots and its essential shared runtime works in this checkout. It runs in the same fail-fast group as `test`, so a quick smoke failure cancels slower siblings.",
            surfaces: ["job:smoke"],
          },
        ],
      },
      {
        id: "staged-pipeline",
        title: "The staged pipeline",
        what: `Gate work runs in ${
          codeList(STAGES, "then")
        } order: stages run serially, and the jobs inside a stage run in parallel.`,
        why:
          "Mutating fixers can never race read-only checks, and independent checks never wait on each other.",
        surfaces: STAGES.map((s) => `stage:${s}`),
        children: [
          {
            id: "fail-fast",
            title: "Fail-fast cancellation",
            what:
              "`[gate].fail_fast` (on by default) tree-kills the in-flight sibling jobs the moment one fails, including their grandchild processes. Set it false to collect every failure in one pass.",
            why: "An agent iterating on a red gate gets its answer sooner.",
          },
          {
            id: "job-timeouts",
            title: "Job time budgets",
            what:
              "`[gate].timeout` bounds every command the gate runs; a job that needs more takes its own `timeout`. A command that overruns is tree-killed and fails with a plain-language diagnostic.",
            why:
              "The gate can never hang on a watch-mode test runner or a stuck dev server.",
          },
          {
            id: "gate-streaming",
            title: "Live or grouped output",
            what:
              "`[gate].stream` switches between grouped per-job output (the default) and live line-prefixed streaming for watching a slow build.",
          },
          {
            id: "strand-detection",
            title: "Strand detection",
            what:
              "`discern done` fails any stage that leaves uncommitted changes behind, instead of letting a fixer's rewrites sit in the tree without review.",
            why:
              "What the gate verified and what gets committed are the same tree.",
          },
        ],
      },
      {
        id: "gate-preconditions",
        title: "Fail-fast preconditions",
        what:
          "Before any job runs, the gate checks the branch's merge state against the trunk and the generated files' currency, and points a behind or drifted tree at the one command that fixes it.",
        why:
          "A ten-minute test run never ends in a merge-conflict surprise it could have named up front.",
      },
      {
        id: "scope-gates",
        title: "Scopes",
        what:
          "`[scopes.<name>]` names a region of the repository by path globs. A scope can be `neutral` (changes there need no gate), `previewable` (worth a preview link), or carry its own `gate` command that runs only when the region changed.",
        why:
          "A docs edit doesn't pay for a compile, and a sub-component's own checks fire only when it moved.",
        surfaces: ["config:scopes"],
        children: [
          {
            id: "fail-open-classification",
            title: "Fail-open classification",
            what:
              "A path matching no scope counts as a real code change, so an unknown path runs more gates, never fewer.",
            why:
              "Misconfiguration errs toward checking too much, never too little.",
          },
        ],
      },
      {
        id: "prepare",
        title: "The fast inner loop",
        what:
          "`discern prepare` runs the fix-stage jobs then the check-stage jobs, and never builds or tests — the quick pass while iterating, before the full `discern done`.",
        why: "Cheap feedback while the change is still moving.",
        surfaces: ["verb:prepare"],
      },
      {
        id: "test-verb",
        title: "Tests on their own",
        what:
          "`discern test` runs the configured test job (and `smoke`) outside the full gate, and reports a trivial pass with a note when no test command is configured.",
        surfaces: ["verb:test"],
      },
      {
        id: "diagnostics",
        title: "Normalized diagnostics",
        what:
          "A failed job returns structured diagnostics: the tool, file and line when available, the message, and the exact command to reproduce it. Oversized captured output is normalized and offloaded to a file instead of flooding the result.",
        why:
          "The fix starts at the cause; nothing needs re-running to see what failed.",
      },
      {
        id: "gotchas-pointer",
        title: "The gotchas pointer",
        what:
          "When a stage fails in a non-obvious way, the gate points at `[project].gotchas_doc` — the project's own record of its stack's traps.",
        why:
          "Hard-won failure lore reaches the agent at the moment it applies.",
      },
      {
        id: "receipt",
        title: "The receipt",
        what:
          "A green `discern done` over a clean, committed tree ahead of the trunk emits a review summary: the branch and the pinned `HEAD`, the commits, changed files, check results, and held standards. `discern accept` can reuse it while that commit and worktree stand; a later commit invalidates it. The same green run fires a registered hint to exercise the real artifact along the changed paths before offering the receipt.",
        why:
          "The owner reviews a verified claim that names the tree it vouches for.",
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "standards",
    title: "Standards",
    what:
      "Named quality numbers held under `[standards]`: each declares a metric, a direction, and a limit, and every gate run verifies no limit loosened versus the trunk.",
    why:
      "Quality limits move in one direction. A floor may only rise, a ceiling may only fall, and a branch that loosens either fails the gate.",
    surfaces: ["verb:standards", "config:standards"],
    children: [
      {
        id: "standards-direction",
        title: "Floors and ceilings",
        what:
          '`direction = "up"` holds a floor (coverage may only rise); `direction = "down"` holds a ceiling (a size budget may only fall). The comparison is against the trunk\'s limit, so loosening on a branch fails the gate.',
      },
      {
        id: "standards-metric-protocol",
        title: "One-line metric protocol",
        what:
          "A standard's `run` is any command that prints `DISCERN_METRIC <name> <number>`; the last such line wins. Any tool in any language can feed a standard.",
        why:
          "No plugin API to write. If it can print a line, it can be a standard.",
      },
      {
        id: "standards-rates",
        title: "Rates, not raw counts",
        what:
          "`per` divides the metric by a second metric or by a built-in extent discern measures itself — files, lines, words, or bytes over a pathspec — and `scale` makes the rate read in human units.",
        why:
          "A number normalized to project size doesn't rise because the project grew, so the standard survives legitimate growth.",
      },
      {
        id: "standards-margin",
        title: "Pin headroom",
        what:
          "`margin` is the headroom a pin leaves when tightening a limit, for metrics that drift on unrelated commits.",
      },
      {
        id: "standards-replay",
        title: "Input-keyed replay",
        what:
          "`inputs` names the paths a metric reads. When nothing under them changed since the last recorded measurement, the gate replays the recorded value instead of re-measuring.",
        why:
          "A docs-only change pays seconds for a coverage standard, and the never-loosen check still runs.",
      },
      {
        id: "standards-on-demand",
        title: "On-demand measurement",
        what:
          '`measure = "on-demand"` defers a metric too slow for every gate run to `discern standards`; the limit check itself has no off switch.',
      },
      {
        id: "standards-pin",
        title: "Capturing a gain",
        what:
          "`discern standards --pin` tightens each improved limit to the value just measured and commits the change on its own, carrying the gate receipt across the pin commit. It measures once: a green check records a measurement receipt the pin replays.",
        why:
          "Tightening is mechanical and provable; a hand-edit can't tell a real gain from a quiet loosening.",
      },
      {
        id: "standards-escalation",
        title: "Breach escalation",
        what:
          "A limit the work itself breached is an owner decision: the built-in guidance has agents cut waste they added and report genuine growth, rather than move a limit to pass.",
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "worktrees",
    title: "Isolated worktrees",
    what:
      "Every task gets its own linked git worktree: a separate checkout and branch forked from the trunk, provisioned with its own port, env values, and declared resources.",
    why:
      "Parallel agents cannot collide — with each other, or with the human's own checkout.",
    surfaces: ["config:worktree", "config:repository"],
    children: [
      {
        id: "start",
        title: "Start",
        what:
          "`discern start` creates the worktree from the main checkout — forked from the trunk regardless of the branch the checkout sits on — and returns its path. `--name` is normalized to a branch-safe slug; omit it for a random codename.",
        surfaces: ["verb:start"],
      },
      {
        id: "update",
        title: "Update",
        what:
          "`discern update` merges the latest trunk into the branch and refreshes the generated files in one idempotent step, reporting what changed beneath the branch and which of your files the incoming trunk also touched.",
        why:
          "Staying current is one verb, and the overlap report names the files to re-check after a clean merge.",
        surfaces: ["verb:update"],
      },
      {
        id: "accept",
        title: "Accept",
        what:
          "`discern accept` lands the reviewed branch on the trunk as a clean fast-forward, validates the exact tree it lands (fast-pathed by the receipt), tears down resources, removes the worktree and branch, refreshes the landing checkout, and runs `[repository].ensure` and `smoke` after landing. It requires a `--confirmed` attestation.",
        why:
          "Landing is atomic and consented: the tree the owner reviewed is the tree that lands, and nothing of the task is left behind.",
        surfaces: ["verb:accept"],
      },
      {
        id: "compose-below-trunk",
        title: "Composing unlanded work",
        what:
          "`start` and `update` both take a `from` ref, so work can build on another branch's unlanded changes; only `accept` lands on the trunk.",
        why:
          "Stacked efforts stay possible without ever making the trunk a merge scratchpad.",
      },
      {
        id: "worktree-identity",
        title: "Deterministic identity",
        what:
          "Each worktree carries stable derived values — id, branch, site name, database name, and a dev-server port hashed from its id — readable with `discern identity` and exported into its env files.",
        why:
          "Concurrent dev servers and test databases never fight over a name.",
        surfaces: ["verb:identity"],
      },
      {
        id: "worktree-resources",
        title: "Per-worktree resources",
        what:
          "`[worktree.resources.<name>]` declares an external thing a worktree needs in isolation — a database, an emulator, a container — as a `create` and a `destroy` command with optional `ensure`, `required`, `retries`, and `gc`. Resources are created top-to-bottom, destroyed bottom-to-top, and expanded with `@…@` identity tokens.",
        why:
          "Isolation extends past the checkout to everything the checkout touches.",
      },
      {
        id: "worktree-prune",
        title: "Orphan reclamation",
        what:
          "`discern worktree prune` finds resources whose worktree vanished without a clean teardown and runs their `destroy` commands — the GC safety net behind the lifecycle verbs (`setup`, `ensure`, `teardown`, `drop`).",
        why: "A crashed session can't leak databases forever.",
        surfaces: ["verb:worktree"],
      },
      {
        id: "env-inheritance",
        title: "Env inheritance",
        what:
          "`[worktree].inherit_env` copies named values from the main checkout's env files into a new worktree's — the secrets a fresh checkout needs that version control doesn't carry.",
      },
      {
        id: "ignored-drift",
        title: "Ignored-file drift",
        what:
          "The lifecycle fingerprints ignored files at setup and reports top-level ignored paths that changed before the worktree is removed.",
        why:
          "Work hiding outside version control gets named before teardown deletes it.",
      },
      {
        id: "fleet",
        title: "The fleet view",
        what:
          "From the main checkout, `discern status` reports a row per worktree: branch, clean state, ahead/behind, last activity, a broken flag for a checkout whose creation never completed, and cross-worktree changed-file collisions.",
        why:
          "The human steers parallel work without visiting each checkout, and two efforts touching the same file get named before either lands.",
      },
      {
        id: "desk",
        title: "The desk",
        what:
          "Bare `discern` opens the operator's desk: an interactive surface over the fleet that starts tasks, opens configured coding-agent CLIs found on `PATH`, and offers each worktree its valid next actions, owning the child sessions it launches.",
        why:
          "The human's day-to-day surface is one screen, and every action on it is one keypress.",
        surfaces: ["verb:desk"],
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "guidance",
    title: "Agent guidance",
    what:
      "One authored guidance source compiles into every configured agent's instruction file. discern's built-in operating guidance is always prepended, so your sources extend it rather than replace it.",
    why:
      "Author once; every agent — cloud agents included — reads the same page.",
    surfaces: ["config:guidance", "verb:refresh"],
    children: [
      {
        id: "guidance-compile",
        title: "Author once, compile everywhere",
        what:
          "`discern refresh` compiles the built-in guidance plus `[guidance].sources` into one generated file per provider. The outputs are committed, and a generated file that drifts from its sources fails the gate.",
        why:
          "A bare clone hands every agent current instructions, and stale copies cannot survive review.",
      },
      {
        id: "guidance-conditionals",
        title: "Config-aware guidance",
        what:
          "The built-in guidance is templated on the project's config, so a project without worktree resources or standards never ships agents instructions about them.",
        why: "Agents read guidance about the project they're in, nothing else.",
      },
      {
        id: "providers",
        title: "Agent providers",
        what: `The native providers — ${
          codeList([...AGENT_NAMES], "and")
        } — each get their integration files from one typed registry: guidance target, settings seed, hooks, and MCP wiring.`,
        why:
          "Supporting an agent is registry data; parity guards keep every provider surface complete.",
        children: [
          {
            id: "provider-claude-code",
            title: "Claude Code",
            what:
              "Reads the generated `CLAUDE.md`; discern seeds `.claude/settings.json` with session-start and worktree lifecycle hooks and wires the MCP server into `.mcp.json`.",
            surfaces: ["agent:claude_code"],
          },
          {
            id: "provider-codex",
            title: "Codex",
            what:
              "Reads `AGENTS.md` — the canonical agent file the other AGENTS.md-native providers reuse; discern co-manages its config, hooks, rules, and worktree environment files.",
            surfaces: ["agent:codex"],
          },
          {
            id: "provider-gemini",
            title: "Gemini",
            what:
              "Reads the generated `GEMINI.md`, with settings and MCP wiring under `.gemini/`.",
            surfaces: ["agent:gemini"],
          },
          {
            id: "provider-cursor",
            title: "Cursor",
            what:
              "Reuses the canonical `AGENTS.md` and gets its own hooks and MCP wiring under `.cursor/`.",
            surfaces: ["agent:cursor"],
          },
          {
            id: "provider-copilot",
            title: "GitHub Copilot",
            what:
              "Reuses the canonical `AGENTS.md`, with hook wiring under `.github/`, sharing the co-owned `.mcp.json` through one writer.",
            surfaces: ["agent:copilot"],
          },
        ],
      },
      {
        id: "session-hooks",
        title: "Session and lifecycle hooks",
        what:
          "Provider hooks run `discern worktree ensure` at session start — idempotent re-readiness plus a reminder while setup is unfinished — and hand worktree create/remove events to the binary, with no `jq` or shell parsing in between.",
        why:
          "A session starts ready, or says what's missing, before any work begins.",
      },
      {
        id: "agent-autodetect",
        title: "Detection at setup",
        what:
          "A fresh install resolves its default agent set by detecting the agents present on `PATH`, and a wider identity catalogue recognizes the agent driving a session as advisory logbook evidence.",
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "skills",
    title: "Skills",
    what:
      "Focused, reusable task playbooks shipped as `SKILL.md` files: discern's bundled built-ins plus any the project authors under `[skills].dir`, materialized into each agent's skills directory.",
    why:
      "Procedures that took a hard session to learn become one file every future session inherits.",
    surfaces: ["config:skills", "verb:skills"],
    children: [
      {
        id: "skills-materialization",
        title: "Materialization",
        what:
          "`discern refresh` materializes the effective set into each agent's gitignored skills directory: built-ins copied, authored skills symlinked so edits stay live. An authored skill overrides a built-in of the same name, `[skills].exclude` drops named ones, and `discern skills eject <name>` copies a built-in into the project to customize.",
        why:
          "The skill set is declared once and identical for every agent, and customizing never forks the distribution.",
      },
      {
        id: "skills-curation",
        title: "A curated bundled set",
        what:
          "The built-ins ship the practice discern teaches — prefixed `discern-`, listed by `discern skills list`, and held to a bar: a bundled skill must teach what a frontier model wouldn't do unprompted. A playbook whose trigger is a conversational ask ships as a skill; a discipline whose trigger is a verb moment ships as a registered hint fired at that moment.",
        why:
          "Every description spends context in every session, so the set stays small and each member earns its keep.",
        children: [
          {
            id: "skill-cure-a-bug",
            title: "Cure a bug",
            what:
              "One bug discipline with three routed modes: prove the cause (reproduce the failure and falsify hypotheses before any fix), cure the class (fix every instance and leave a permanent guard), and audit existing guards for coverage that guards less than it appears to.",
            surfaces: ["skill:discern-cure-a-bug"],
          },
          {
            id: "skill-set-the-standard",
            title: "Set the standard",
            what:
              "Put a quality metric behind a standard — a defendable number, wired into `[standards]`, limited at today's value — with a drive-to-zero mode that outlaws a legacy pattern: a detector, a falling ceiling, then a permanent gate rule at zero.",
            surfaces: ["skill:discern-set-the-standard"],
          },
          {
            id: "skill-clear-the-decks",
            title: "Clear the decks",
            what:
              "Sweep out the clutter agent-built codebases accumulate — duplicated helpers, dead code from abandoned approaches, one-caller indirection, leftover scaffolding — every cut proven safe, landed as small behavior-preserving commits, with the entropy capped by a standard.",
            surfaces: ["skill:discern-clear-the-decks"],
          },
          {
            id: "skill-delegate-work",
            title: "Delegate work",
            what:
              "Turn the work under discussion into complete, self-contained prompts for fresh agents in their own worktrees — one handoff, a parallel fan-out, or staged briefs — then review what lands adversarially.",
            surfaces: ["skill:discern-delegate-work"],
          },
          {
            id: "skill-document-subsystem",
            title: "Document a subsystem",
            what:
              "Write or refresh one subsystem's subtree of the map from the real code, following the documenter brief that `discern setup` seeds under the map's `_internal/` scaffolding.",
            surfaces: ["skill:discern-document-subsystem"],
          },
          {
            id: "skill-teach-the-project",
            title: "Teach the project",
            what:
              "Route a session's lesson into the project's own surfaces — a guidance line, an authored skill, a project script, a doc, or a decision record — so every future session inherits it.",
            surfaces: ["skill:discern-teach-the-project"],
          },
          {
            id: "skill-write-adr",
            title: "Write an ADR",
            what:
              "Guide recording a significant decision — context, decision, consequences, alternatives — from the canonical template and format guide every install carries.",
            surfaces: ["skill:discern-write-adr"],
          },
        ],
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "map",
    title: "The map",
    what:
      "The agent-maintained documentation tree at `[map].dir`: agents write it and keep it current under the gate; humans read it as documentation and as an audit of what their agents understand.",
    why:
      "Documentation stops being the thing nobody updates: staleness fails the gate, and reading the map shows the owner what the agents believe.",
    surfaces: ["config:map", "verb:map"],
    children: [
      {
        id: "map-browser",
        title: "The map browser",
        what:
          "`discern map` lists, searches, and renders the tree in the terminal — frontmatter search aliases included — and `--export` writes a public, full, or selected projection to one file.",
        surfaces: ["verb:map"],
      },
      {
        id: "docs-integrity",
        title: "The docs integrity gate",
        what:
          "The gate validates the map's substance: intra-map links and heading anchors against the shared renderer, fenced `discern` examples against the live verb and flag registry, frontmatter against a schema, and the published tiers against the audience boundary.",
        why:
          "A rename breaks the docs loudly, in the same change, instead of quietly a month later.",
      },
      {
        id: "map-freshness",
        title: "File-linked freshness",
        what:
          "Map freshness ships as file-linked facts — which source files a page covers and when they moved — rather than verdicts.",
      },
      {
        id: "publish-predicate",
        title: "Publication control",
        what:
          "`publish: false` in a page's frontmatter withholds it from every published surface, and underscore-prefixed trees (`_internal`, `_private`) never ship; decision records are the one semi-public exception, served by `discern help --adr` and the site's history pages.",
        why: "One predicate answers what ships, everywhere it could ship.",
      },
      {
        id: "adr-discipline",
        title: "Decision records",
        what:
          "Architecture Decision Records live under `_adr/`, numbered continuously, with a canonical template and format guide scaffolded into every install. Citations take one strippable form, removed at render time on human surfaces.",
        why:
          "The why behind the code survives the sessions that wrote it, without leaking internal numbering into shipped prose.",
      },
      {
        id: "bundled-help",
        title: "discern's own manual",
        what:
          "The binary carries its own public documentation: `discern help` browses it offline in any install, over the same renderer the map uses, and customer binaries carry only the public projection.",
        why:
          "Every install can answer how discern works with no network and no wiki.",
        surfaces: ["verb:help"],
      },
      {
        id: "glossary-canon",
        title: "The vocabulary canon",
        what:
          "The glossary compiles from a term registry: one definition per term, every term a search alias, retired synonyms policed out of live prose, and closed-set members enrolled the moment they exist.",
        why: "Every page and every agent uses one name per concept.",
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "insight",
    title: "Advisories and the logbook",
    what:
      "Read-only surfaces that point at work and never block: the gate and standards are the only enforcement, and everything else reports.",
    why:
      "Signal without new failure modes — an advisory can be wrong without stopping anyone.",
    surfaces: ["config:coupling"],
    children: [
      {
        id: "status",
        title: "Status",
        what:
          "`discern status` reports what is true right now: location, branch state against the trunk, what the gate would fire, receipt state, worktree identity and resources, configured standards, staleness flags for generated files, and advisory next steps — with the fleet survey from the main checkout.",
        why:
          "Orientation is one cheap read-only call, for agents and humans alike.",
        surfaces: ["verb:status"],
      },
      {
        id: "impact",
        title: "Impact",
        what:
          "`discern impact` names the scopes the current change wakes, and `--has <scope>` answers it as an exit code for scripts.",
        surfaces: ["verb:impact"],
      },
      {
        id: "coupling",
        title: "Coupling",
        what:
          "`discern coupling` mines the repo's own commit history for files that change together: what your change set is missing, one file's habitual partners, or the shared history of two files. Zero-config and self-calibrating; `[coupling].in_gate` surfaces it as gate-tail hints.",
        why:
          "The sibling file everyone forgets gets named while the change is still open.",
        surfaces: ["verb:coupling"],
      },
      {
        id: "improvement",
        title: "Improvement",
        what:
          "`discern improvement` ranks the highest-value next action from deterministic rules and subjective reviews across the gate, setup, guidance, map, worktrees, standards, and skills, scoring project health 0–100.",
        why:
          "A coach with a ranked list, for the question 'what should we fix next?'.",
        surfaces: ["verb:improvement"],
      },
      {
        id: "logbook",
        title: "The logbook",
        what:
          "One metadata-only line per verb run, appended under `.git` and shared by the repository's worktrees: timings, outcomes, names, and fired hint ids — never code, never command output. It never leaves the machine (a gate test keeps the logbook code free of network paths), rotates by age, and `[project].logbook = false` stops all writes.",
        why:
          "The practice becomes measurable evidence without anything leaving the building.",
      },
      {
        id: "patterns",
        title: "Patterns",
        what:
          "`discern patterns` mines the logbook with a registry of named detectors across behavior loops, gate fit, funnel flow, and standard trajectories — done-thrash, refusal loops, ignored update advice, abandoned worktrees, duration creep, and their kin — each finding stated in plain counts with a next step. Below a detector's evidence threshold it reports insufficient evidence, and `patterns reset` deletes the recorded history.",
        why:
          "Recurring workflow failures surface as counted findings instead of anecdotes.",
        surfaces: ["verb:patterns"],
      },
      {
        id: "hints",
        title: "Registered hints",
        what:
          "Every advisory hint the engine can emit is an entry in one typed registry — id, category, audience, family, and a parameterized template — with a generated inventory page, command references validated against the live verb registry, and fired ids recorded in the logbook.",
        why:
          "Advice stays current mechanically, and whether advice gets followed is measurable.",
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "install",
    title: "Install and lifecycle",
    what:
      "One binary installs, verifies, upgrades, and removes the system, and a project's entire footprint is one root file: `discern.toml`.",
    why:
      "Adopting discern is one file in the diff, and leaving is one command — the exit is as clean as the entrance.",
    surfaces: ["config:meta", "config:project"],
    children: [
      {
        id: "setup",
        title: "Agent-driven setup",
        what:
          "`discern setup` is a staged, consent-driven handshake the coding agent completes: it verifies write authority, detects the default branch (offering git init on a bare directory), sniffs the repo to fill `[jobs]`, proves the project runs in a worktree, and lands the finished configuration with `setup accept`. Each step serves ready-to-relay messages, a fresh scaffold requires a `--confirmed` attestation, and installing a dependency is its own consent point.",
        why:
          "Tell your agent to run setup and answer its questions; the configuration engine is the agent, and every irreversible step asks first.",
        surfaces: ["verb:setup"],
      },
      {
        id: "setup-observability",
        title: "Observable incompleteness",
        what:
          "An unfinished setup is a machine-readable state, reported by `discern status` and the session-start hook until the handshake completes.",
        why:
          "A half-installed project says so itself; nobody discovers it mid-task.",
      },
      {
        id: "doctor",
        title: "Doctor",
        what:
          "`discern doctor` verifies the installation without changing it — config validity, schema version, job commands on `PATH`, git and shell prerequisites, guidance sources, skills, worktree automation, resource commands — and prints each verb's execution model: which steps are the project's and which are discern's.",
        why:
          "Facts before judgments, and a misconfigured install names its own fix.",
        surfaces: ["verb:doctor"],
      },
      {
        id: "upgrade",
        title: "Upgrade and migrations",
        what:
          "`discern upgrade` brings the project in line with the binary that runs it: versioned, idempotent config migrations that validate before the schema version is stamped, refusal of configs newer than the binary, and reconciliation of the fixed `discern.toml` scaffold and the marked `.gitignore` block. `--check` previews without touching anything.",
        why:
          "Updating never means re-reading a changelog; the binary carries its own path forward and refuses to guess.",
        surfaces: ["verb:upgrade"],
      },
      {
        id: "ownership-buckets",
        title: "File ownership",
        what:
          "Every file discern touches is project-owned (written once, then yours), shared (`discern.toml` and the marked `.gitignore` block, with discern owning only its marked regions), or generated (safe to overwrite because the source is yours). Upgrade honors the buckets, and the removal set derives from the same registry.",
        why:
          "What an upgrade may touch is a lookup, never a judgment call — your files stay yours.",
      },
      {
        id: "placement-consent",
        title: "Placement is consent",
        what:
          "discern and its agents write only where placement licenses it: a file at its namespace default carries an implicit write-license, a config key you pointed elsewhere is an explicit one, and any other path is untouchable — enforced by an architectural test.",
        surfaces: ["config:scripts"],
      },
      {
        id: "uninstall",
        title: "Uninstall",
        what:
          "`discern uninstall` removes the wiring discern laid down — derived from the ownership registry — and keeps `discern.toml`, your guidance, and the map.",
        why: "Leaving costs one command and loses no authored work.",
        surfaces: ["verb:uninstall"],
      },
      {
        id: "presets",
        title: "Presets",
        what:
          "`discern preset <name>` applies a reusable overlay: scaffolded files plus config fills that never overwrite a value the project already sets, each key disclosed as filled or kept.",
        surfaces: ["verb:preset"],
      },
      {
        id: "config-command",
        title: "Config without a parser",
        what:
          "`discern config` edits `discern.toml` while preserving comments and layout — `set`, `set-job`, `set-scope`, `set-standard` — and reads it back raw with `get`, `array`, `has`, `subsections`, and `keys`, so scripts and agents never parse TOML themselves.",
        surfaces: ["verb:config"],
      },
      {
        id: "licenses",
        title: "Third-party notices",
        what:
          "`discern licenses` prints the bundled third-party notices, generated from the compile graph rather than a hand-kept list.",
        surfaces: ["verb:licenses"],
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "interfaces",
    title: "Interfaces and contracts",
    what:
      "Every verb speaks human and machine: one result envelope, a first-class MCP surface, and published schemas for both config and results.",
    why:
      "Agents integrate against typed contracts, and the human output is a rendering of the same object the machine gets.",
    surfaces: ["verb:mcp"],
    children: [
      {
        id: "result-envelope",
        title: "One result envelope",
        what:
          "A verb returns one structured result — status, message, steps, data, hints, diagnostics — and `--json` serializes it; the human renderer draws from the same envelope, so no surface carries prose another lacks.",
      },
      {
        id: "plan-apply",
        title: "Plan and apply",
        what:
          "Every effectful verb computes a pure, read-only plan a thin executor applies, which is what makes `--dry-run` a faithful preview on `done`, `standards`, `start`, `update`, `accept`, `setup`, `upgrade`, `uninstall`, and the worktree lifecycle.",
        why: "Any mutating operation can be rehearsed before it happens.",
      },
      {
        id: "mcp-surface",
        title: "The MCP server",
        what:
          "`discern mcp` serves the verbs as tools over stdio on the official SDK — self-describing schemas derived from the typed result contracts, strict argument validation, a tracked working root that `discern_start` re-aims at the new worktree, and read-only resources for status, impact, config, help, and the map.",
        why:
          "MCP-native agents call structured tools; the CLI and the tools can never disagree because they share one core per verb.",
      },
      {
        id: "published-contracts",
        title: "Published contracts",
        what:
          "The config schema and every verb's result shape publish as generated JSON Schemas and TypeScript declarations, regenerated by the build and drift-guarded in the gate.",
      },
      {
        id: "project-scripts",
        title: "Project scripts",
        what:
          "Any executable dropped under `[scripts].dir` becomes `discern script <name>`: language-agnostic, `DISCERN_*` environment exported, arguments forwarded unchanged, and an optional `# desc:` line for the listing. Scripts occupy their own namespace, so built-in verb names stay legal.",
        why:
          "The project's own tooling gets discern's context — root, config, worktree identity — without wrapper boilerplate.",
        surfaces: ["verb:script"],
      },
      {
        id: "forgiving-cli",
        title: "A forgiving command line",
        what:
          "Retired command names refuse with their successor named, synonyms suggest the canonical verb, grammatical variants normalize, and unknown commands get a did-you-mean built from the live verb set.",
        why: "Vocabulary changes never strand a user or an agent mid-habit.",
      },
      {
        id: "output-discipline",
        title: "Terminal discipline",
        what:
          "`--no-color` and `NO_COLOR` are honored, non-TTY output drops decoration, `--plain` suppresses prompts and paging for CI, and the pager respects `PAGER`.",
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "foundations",
    title: "Foundations",
    what:
      "The properties the rest of the product stands on — each one a design commitment, not a configuration.",
    why:
      "The guarantees hold everywhere because they are structural: no optional subsystem, no partial install, no second copy of anything.",
    children: [
      {
        id: "single-binary",
        kind: "benefit",
        title: "One self-contained binary",
        what:
          "Installer and engine are one program with no runtime dependencies; every verb runs and exits, and discern is never a runtime dependency of the project.",
        why:
          "Nothing to babysit: no daemon, no lockfile entry, no version skew between components.",
      },
      {
        id: "one-file-footprint",
        kind: "benefit",
        title: "A one-file footprint",
        what:
          "A project's entire configuration is the root `discern.toml`; everything else is bundled, config-pointed, or generated output.",
        why: "Reviewing what discern does to a repo is reading one file.",
      },
      {
        id: "stack-neutral",
        kind: "benefit",
        title: "Stack-neutral",
        what:
          "The engine ships no stack commands of its own: the gate, scopes, standards, and resources run whatever commands the project declares, in any language.",
        why: "One system serves the polyglot reality instead of one ecosystem.",
      },
      {
        id: "no-model-inside",
        kind: "benefit",
        title: "No model inside",
        what:
          "discern contains no LLM and needs no API key. Verdicts come from the project's own commands; the agent supplies the intelligence and discern supplies the judgment infrastructure.",
        why:
          "The gate's answer is reproducible and free, however many times it runs.",
      },
      {
        id: "local-evidence",
        kind: "benefit",
        title: "Evidence stays local",
        what:
          "The logbook and every advisory reader run entirely on the machine; recording is on by default because local metadata costs nothing to keep and everything to lose.",
      },
      {
        id: "all-subsystems-core",
        kind: "benefit",
        title: "Every subsystem is core",
        what:
          "There are no feature toggles: every verb attaches unconditionally, and configuration tunes behavior rather than enabling it.",
        why:
          "Every install is the same product, so guidance, docs, and habits transfer between projects verbatim.",
      },
      {
        id: "forcing-functions",
        kind: "benefit",
        title: "Forcing-function parity",
        what:
          "Every canonical set — verbs, tools, jobs, providers, config schema, terms, hints, features — is tied to its satellites by guards that fail the gate when a member is added without its counterparts.",
        why: "The system cannot disagree with itself and stay green.",
      },
      {
        id: "dogfooding",
        kind: "benefit",
        title: "Run on itself",
        what:
          "The discern repository develops under its own gate, worktrees, standards, map, and logbook; a regression in the engine surfaces in discern's own `discern done`.",
        why: "The vendor feels every sharp edge before a user does.",
      },
      {
        id: "interruption-safety",
        kind: "benefit",
        title: "Clean under interruption",
        what:
          "Cancellation reaches the gate's detached process groups, temp output artifacts are reaped by age from one registry, and orphaned worktree resources are reclaimed by prune.",
        why: "A killed session leaves a machine you'd still want to work on.",
      },
    ],
  },
];

/**
 * Closed-set members deliberately NOT claimed by any feature node, each with
 * the reason. Keys are namespaced `<set>:<member>`, exactly as `surfaces`
 * claims are. The enrolment guard holds every member to exactly one of:
 * claimed in the tree, or recorded here.
 */
export const FEATURES_DELIBERATELY_ABSENT: Readonly<Record<string, string>> =
  {};

/** One flattened node with its position in the tree. */
export interface FlattenedFeature {
  node: FeatureNode;
  /** 0 for a pillar. */
  depth: number;
  /** The parent node's id, absent for a pillar. */
  parent?: string;
}

/** Every node in authoring order, flattened with depth and parent. */
export function allFeatureNodes(
  tree: readonly FeatureNode[] = FEATURE_CANON,
): FlattenedFeature[] {
  const out: FlattenedFeature[] = [];
  const walk = (
    nodes: readonly FeatureNode[],
    depth: number,
    parent?: string,
  ): void => {
    for (const node of nodes) {
      out.push(
        parent === undefined ? { node, depth } : { node, depth, parent },
      );
      walk(node.children ?? [], depth + 1, node.id);
    }
  };
  walk(tree, 0);
  return out;
}

/** A parsed `set:member` surface claim. */
export interface SurfaceClaim {
  set: SurfaceSet;
  member: string;
  /** The claiming node's id. */
  claimedBy: string;
}

/** Split a `set:member` key, or return undefined when it has no colon. */
export function parseSurfaceKey(
  key: string,
): { set: string; member: string } | undefined {
  const at = key.indexOf(":");
  if (at === -1) return undefined;
  return { set: key.slice(0, at), member: key.slice(at + 1) };
}

/**
 * Every surface claim in the tree, in authoring order. Malformed keys throw:
 * the registry is data the guards depend on, so a bad key fails loudly at
 * read time rather than passing unparsed.
 */
export function allSurfaceClaims(
  tree: readonly FeatureNode[] = FEATURE_CANON,
): SurfaceClaim[] {
  const claims: SurfaceClaim[] = [];
  for (const { node } of allFeatureNodes(tree)) {
    for (const key of node.surfaces ?? []) {
      const parsed = parseSurfaceKey(key);
      if (parsed === undefined) {
        throw new Error(`malformed surface key on ${node.id}: ${key}`);
      }
      if (!(SURFACE_SETS as readonly string[]).includes(parsed.set)) {
        throw new Error(`unknown surface set on ${node.id}: ${key}`);
      }
      claims.push({
        set: parsed.set as SurfaceSet,
        member: parsed.member,
        claimedBy: node.id,
      });
    }
  }
  return claims;
}

/** Where the generated canon page lives inside the map. */
export const FEATURE_CANON_PAGE_REL: string = join(
  "_internal",
  "feature-canon.md",
);

/** The banner stamped atop the generated canon page. */
const DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the feature registry (scripts/feature_registry.ts) — do NOT edit by hand. Change a node there and regenerate. -->";

/** Render one node as a bullet at the given indent depth. */
function renderNode(node: FeatureNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const marker = node.kind === "benefit" ? " *(benefit)*" : "";
  const why = node.why === undefined ? "" : ` *${node.why}*`;
  const lines = [`${indent}- **${node.title}**${marker} — ${node.what}${why}`];
  for (const child of node.children ?? []) {
    lines.push(...renderNode(child, depth + 1));
  }
  return lines;
}

/** Render the coverage appendix: every claim, grouped by set then member. */
function renderCoverage(): string[] {
  const claims = allSurfaceClaims();
  const bySet = new Map<SurfaceSet, Map<string, string[]>>();
  for (const claim of claims) {
    const members = bySet.get(claim.set) ?? new Map<string, string[]>();
    const ids = members.get(claim.member) ?? [];
    ids.push(claim.claimedBy);
    members.set(claim.member, ids);
    bySet.set(claim.set, members);
  }
  const lines: string[] = ["## Closed-set coverage", ""];
  lines.push(
    "Every member of the product's closed sets, with the node that claims it. The enrolment guard (`tests/feature_canon_enrolment_test.ts`) holds this mapping complete and live.",
    "",
  );
  for (const set of SURFACE_SETS) {
    const members = bySet.get(set);
    if (members === undefined) continue;
    lines.push(`### \`${set}\``, "");
    for (const member of [...members.keys()].sort()) {
      const ids = members.get(member) ?? [];
      lines.push(`- \`${member}\` — ${ids.join(", ")}`);
    }
    lines.push("");
  }
  const absent = Object.entries(FEATURES_DELIBERATELY_ABSENT);
  lines.push("### Recorded absences", "");
  if (absent.length === 0) {
    lines.push("- None: every closed-set member is claimed by a node.", "");
  } else {
    for (const [key, reason] of absent) {
      lines.push(`- \`${key}\` — ${reason}`);
    }
    lines.push("");
  }
  return lines;
}

/**
 * Render the maintainer canon page: the at-a-glance pillar list, the full
 * tree at every resolution, and the closed-set coverage appendix.
 */
export function renderFeatureCanonDoc(): string {
  const flattened = allFeatureNodes();
  const benefits = flattened.filter(({ node }) => node.kind === "benefit");
  const claims = allSurfaceClaims();
  const lines: string[] = [
    DOCS_BANNER,
    "",
    "# Feature canon",
    "",
    "_Every product feature and benefit, enumerated once, at every resolution. Creative, technical, and marketing work reads this canon (or `scripts/feature_registry.ts`, which it compiles from) instead of re-deriving the feature list._",
    "",
    `${FEATURE_CANON.length} pillars · ${flattened.length} nodes · ${benefits.length} benefit statements · ${claims.length} closed-set claims. Depth is resolution: the pillars are the one-breath account, the leaves are the exhaustive one.`,
    "",
    "## At a glance",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    lines.push(`- **${pillar.title}** — ${pillar.why ?? pillar.what}`);
  }
  lines.push("");
  for (const pillar of FEATURE_CANON) {
    lines.push(`## ${pillar.title}`, "");
    lines.push(pillar.what, "");
    if (pillar.why !== undefined) lines.push(`*${pillar.why}*`, "");
    for (const child of pillar.children ?? []) {
      lines.push(...renderNode(child, 0));
    }
    lines.push("");
  }
  lines.push(...renderCoverage());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
