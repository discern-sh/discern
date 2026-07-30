---
name: discern-delegate-work
description: Turn the work you've been discussing into complete, self-contained prompts for fresh agents in their own worktrees — one handoff, a parallel fan-out, or staged briefs — then review what lands adversarially. Use when the user wants to delegate, hand off, or spin off work to a new, separate, or clean agent session, wants to parallelise a large effort, split work across agents or worktrees, asks you to "write a prompt for another agent", or to "kick this off in a fresh worktree". Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Delegate work to fresh agents

Handing work to a clean session gives you an isolated worktree, an uncluttered context window, and, when you review what comes back, a second independent pass over the same problem. A delegated agent is only as good as its prompt. It cannot see this conversation; it wakes with the prompt you write plus whatever it finds in a fresh worktree branched from the trunk. A vague brief becomes vague work, in a worktree you then have to go and find.

This skill turns the work you've been discussing into briefs that stand on their own, shapes the handoff so one task goes to one agent and a large effort splits along its real seams, hands the briefs off, and closes the loop with an adversarial review of what lands.

_If the user adds their own instructions or context when invoking this skill, those take precedence. Everything below yields to what they tell you in the moment._

---

## 1. Pin down exactly what you're delegating

Before writing a word, make the work unambiguous: a fresh agent can't ask you what you meant. From the conversation so far, settle three things:

- **The goal.** The single outcome that means done, stated as a result rather than an activity.
- **The shape of the work.** The concrete changes you expect, and anything the discussion already ruled in or out.
- **The unknowns.** Anything still undecided. Resolve it with the user now, or name it in the prompt as a decision the agent must make and justify. A fresh agent fills a silent gap with a guess, and you won't see the guess until you review.

If the discussion was loose, ask the user the one or two questions whose answers would otherwise become the fresh agent's wrong assumptions.

---

## 2. Shape the handoff: one brief, a fan-out, or stages

Decide how many agents, prompts, and worktrees the work wants. Pick the simplest shape that fits; a split where no seam exists costs more than it saves.

- **One task → one brief.** The default. One agent, one fresh worktree, one prompt. Skip to §3.
- **Independent streams inside one task → one brief that fans out.** If the task has streams that could run at once and the receiving agent can likely launch its own sub-agents, tell it to do exactly that: "spin up a sub-agent per stream and run them in parallel." Phrase it as a preference with a fallback ("if you can run sub-agents, parallelise these streams; otherwise do them in sequence") because not every agent can. One prompt, one worktree; the implementing agent does the fanning out.
- **A large effort with real seams → one brief per stream, in parallel worktrees.** Split only on real seams: each stream owns a disjoint slice of the tree, with no files in flight shared across streams. Two worktrees editing the same file relocate the collision to integration time. Check the seam honestly (which files each stream will touch, shared registries and generated files included); where two streams would meet, either merge them into one brief or split the shared piece out as its own stage that lands first. Each stream gets its own self-contained prompt (§3), runs in its own worktree, and lands independently.
- **Dependent milestones → staged briefs, all drafted now.** If B builds on A, draft both while the reasons are fresh. Start A first: `discern_start` adds a uniqueness suffix. Capture its exact returned branch, put it into B's brief, then dispatch B; never guess it from the requested name. B uses `--green` to compose below the trunk or `--landed` to wait for an independently landing stream. After either condition, it follows the met hint: the hint knows whether B is on main or in a worktree, and a live-green result uses the immutable commit rather than the deletable branch. In a below-trunk stack, A stops after green and keeps its branch; it never accepts. Only the final stack crosses the trunk.

**When the handoff yields more than one brief, key each one.** Give every brief a workstream key: the number is the wave, the letter a slot within it. Briefs sharing a number (`1A`, `1B`) touch disjoint territory and run at once. For independently landed waves, a higher number waits for every lower wave to land: `1A`+`1B`+`1C → 2A`. A below-trunk `--from` stack is different: each stage waits only for its predecessor to go green, composes that branch, and leaves landing to the final stage. State which model applies. Within an independent wave, name who updates first; later streams bring landed progress in with `discern_update`.

**Decide landing authority per stream, and write it into the brief.** Independently landed streams and the final stage of a stack either land under the user's grant or stop for review. Three mechanisms carry a grant: conversational acceptance, a standing scope grant in `[acceptance].pre_authorized`, and a per-worktree grant from the desk after dispatch. For those landing briefs, `discern_done` comes first, then `discern_accept`; a recorded grant lands, while no grant returns the receipt for review. An intermediate `--from` stage follows a different explicit close: run `discern_done`, report the green receipt, do **not** run `discern_accept`, and keep the branch available for its dependent. Its work reaches the trunk inside the final stack. Never claim authority in prose; the verb checks the record.

---

## 3. Write a prompt that stands on its own

Assume the new agent knows nothing of this conversation. Everything that mattered here and isn't already plain from the project's own files must be restated. The shared project context (the guidance files, the docs) it can read for itself, so point it at the parts that matter rather than trusting it to find them. Any conclusion the two of you reached that the code does not record must be written into the prompt; nothing else carries it across.

**Mind the worktree boundary.** The fresh agent starts in a clean worktree branched from the trunk, so anything that exists only in your current worktree (an uncommitted file, a research note, work on your branch the trunk doesn't have yet) isn't there for it. If the prompt needs such a file, either paste its content into the prompt or reference it by an absolute path, which resolves across worktrees on the same machine. Never use a relative path: it resolves inside the new worktree, where the file doesn't exist. (You can instead point the new agent at your current worktree, but two lines of work sharing a worktree give up the isolation that makes delegation clean. Prefer inlining or absolute paths unless the task is tightly bound to uncommitted work here.)

Give each prompt a clear spine. Adapt the headings to the task, but cover:

- **Title and one-line goal.** What this achieves, in a sentence. When the handoff spans multiple streams (§2), lead the title with the workstream key: `1B — Add rate limiting to the upload endpoint`.
- **Orient first.** Have it begin with `discern_status` and the project's guidance, then create its named worktree before editing. A staged brief that must wait before branching is the exception described in §2: its first action after orientation is the read-only `discern_await`.
- **Background: why this, why now.** The context you hold and it doesn't: the problem, what's true today, what made the change worth doing. Usually the part only you can supply, and the part most often skipped.
- **Deliverables.** The concrete, ordered changes. For each, say what and where, and name an existing thing to mirror for house style ("model it on X"). Anchor each deliverable in real files, tests, and patterns.
- **Constraints.** The rules it must hold to (see §4).
- **Out of scope.** What not to touch. Named non-goals prevent scope creep. For one stream of a fan-out, the other streams' slices are always out of scope; say so.
- **Definition of done.** Pair a measurable bar with a semantic one. The measurable half is a short, falsifiable checklist ("the gate is green and X, Y, Z hold", never "it works"). The semantic half states the outcome from the user's side ("someone doing the real task can reach the intended result with a smooth, high-quality experience") so the agent aims at work that is correct and well-made, not only work that passes the checks.

**Write the requested worktree name into the brief, literally.** For a multi-stream handoff, derive one short programme slug and give each brief the exact string to pass to `discern_start`: slug first, then key, as in `upgrade-1a`. This groups a programme in the fleet table. Keep it short: discern adds a uniqueness suffix. That returned branch, not the requested name or a prefix match, is the authority inserted into dependent briefs.

Anchor the prompt in the real tree, then tell the agent to verify those anchors against the live code: files move, and a brief written from this conversation can be stale by the time someone runs it.

---

## 4. Bake in what every delegated task needs

A handful of constraints hold for any task in any discern project. Fold them in so the fresh agent inherits them rather than rediscovering them:

- **The gate is the bar for done.** The agent must run the full quality gate (`discern_done`) to green before calling the work complete, iterating with the fast loop (`discern_prepare`) and fixing from the reported diagnostics.
- **Commit atomically.** One logical step per commit, clear messages, so the result reviews cleanly step by step.
- **Never hand-edit generated files.** Change the source and re-run the producing command; the gate flags drift either way.
- **Cure the class, not the symptom.** A real fix leaves behind a check that fails on the whole class of defect (the `discern-cure-a-bug` skill is the procedure).
- **Record notable decisions.** A hard-to-reverse or surprising choice deserves an ADR (the `discern-write-adr` skill).
- **Wait with the verb.** Make one `discern_await` call with the longest safe transport bound; do not slice it into heartbeat calls for progress reports. If it returns "not yet", use its `--resume` command until the condition holds, the user stops the watch, or the task no longer needs the dependency. An `ok: false` refusal has no continuation: follow its recovery hint or report the blocker. Never impose a fixed retry count or replace it with sleeps.

Keep this to a few lines. The agent's own guidance file already states most of it, the project's own rules included; reinforce the constraints this task leans on.

---

## 5. Hand it off

Present each finished prompt as one self-contained block the user can copy verbatim: clearly delimited, complete top to bottom, nothing left for them to fill in by hand. Always present the prompts in the session first.

When there's more than one, also offer to save them as Markdown files in the user's project, each filename prefixed with its workstream key (`1a-<slug>.md`, `2a-<slug>.md`), in a spot you suggest from the project's own layout (an existing planning or prompts folder, say). Files keep the key first — the folder scopes them, and the key sorts them into the wave plan; only worktree names lead with the programme slug (§3). Write them only if the user says yes. Give each brief you save one final line in its own definition of done: when its task is complete, move the brief file into a `_done/` subfolder beside it (`planning/2c-<slug>.md` → `planning/_done/2c-<slug>.md`), landed as part of that work, so completed briefs don't linger for you to tidy. That line belongs only in a saved brief (a chat-only prompt has no file to move), and lands cleanly only once the briefs are committed to the trunk each stream branches from.

Then explain how the handoff runs: each prompt gets an isolated branch and worktree. If you can launch the sessions yourself and the user prefers it, offer; handing over the prompts is the default. Restate the landing order. Start each lower wave first, capture its exact branches, finalize the dependent briefs, then dispatch their long waits. No human has to relay readiness after launch.

---

## 6. Offer to review the result adversarially

Commit to the review at handoff time: when an agent is done, the user gives you the branch or worktree name, and you review it. That second independent pass is half the value of delegating; don't let it lapse into a rubber stamp.

When work returns, review it as its adversary: assume it falls short until the evidence says otherwise.

- **Read the diff, not the summary.** Review the branch's diff against the trunk (`git diff <trunk>...<branch>`) and the changed files (find the branch via `discern_status` if you need to). Review read-only: never start working inside a worktree you didn't create.
- **Hold it to the prompt.** Walk every deliverable and the definition of done, the semantic bar included. Was each one done, or only reported done? What was skipped, half-finished, or quietly added beyond scope?
- **Verify the gate passes.** Run it against the branch (from its own worktree, or a checkout of it) rather than trusting the agent's report, and check the standards (`discern_standards`) if the change touches them.
- **Hunt the known failure modes.** The symptom patched but the class left uncured; a test loosened to pass; a generated file hand-edited; a decision made silently that warranted an ADR; scope creep past what you asked for; and, in a fan-out, a stream that strayed into a sibling's slice.
- **Credit what exceeded the brief.** If the agent caught something you hadn't anticipated, or improved on the spec in a way that helps, name it. Real initiative is a finding too.

Report what you find plainly: what stands, and what needs another pass. Feed any real defect back as the next task, delegated the same way if that fits. For staged work, this review is also the moment to re-read the next wave's briefs against what actually landed: they were written before any of this code existed, so amend the ones that drifted.

---

## Done when

- The work is pinned down: goal, shape, and every unknown either resolved or explicitly handed to the agent to decide.
- The handoff has the simplest shape that fits: one brief, a fan-out on disjoint seams with a fixed landing order, or staged briefs drafted together. Every dependent brief receives the predecessor's exact returned branch before dispatch and names the right composition move for whether it already owns a worktree.
- For a multi-brief handoff, every brief carries its workstream key in its title (and its filename, if saved) and its literal `<slug>-<key>` worktree name, you offered to save the set as Markdown files in the project, and any saved brief tells its agent to move the file into `_done/` when its task is complete.
- Every brief states its close: an independent stream or final stack stage lands under a recorded grant or stops at the receipt; an intermediate stack stage stays green and does not accept.
- Every prompt is self-contained: it assumes no memory of this conversation and carries title, orientation, background, deliverables, constraints, out-of-scope, and a definition of done that is both falsifiable and stated from the user's side.
- The standing project constraints (the gate as the bar, atomic commits, no hand-editing generated files, plus the project's own guidelines) are baked into each.
- The user has each prompt as a copyable block and knows that launching one spins up a fresh worktree.
- You've committed to reviewing each result, and know to ask for the branch or worktree name when it's ready.
