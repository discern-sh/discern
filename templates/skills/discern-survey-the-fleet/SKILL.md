---
name: discern-survey-the-fleet
description: Survey every worktree in the repository and report what is actually going on in each — intent, progress, staleness, collisions — so the user can steer their parallel work without visiting each worktree by hand. Use when the user asks "what's going on in my worktrees?", "where did I leave things?", for a fleet status, overview, or roundup, wants to know what's ready to land or gone stale, or before kicking off new parallel work. Bundled with discern.
---

# Survey the fleet

Parallel work accumulates worktrees, and their owner ends up steering blind: `discern_status` from the main checkout lists the fleet cheaply — branch, dirty or clean, ahead/behind, last activity — but a row can't say *what* each effort is, whether it's nearly done or long dead, or that two of them are about to collide. This skill is the reconnaissance on top: read each worktree's evidence, reconstruct its intent, classify its state, and hand back one report the user can act on.

**Read-only, absolutely.** Every worktree here is someone else's line of work. Run git *reads* against them — never the gate, never a commit, a checkout, a clean, or a "helpful" fix, and never adopt one as a workspace. The deliverable is the report; every action belongs to the owner.

---

## 1. Enumerate from the trunk

From the main checkout, `discern_status` (or `discern status --json`) returns the fleet: one row per worktree with its branch, dirty state, ahead/behind counts, and a last-activity timestamp — note which row is the current checkout. Note the trunk branch name from the same result; every comparison below runs against it. (`git worktree list --porcelain` is the fallback map of worktree paths if you need one.)

---

## 2. Gather evidence per worktree — plumbing, not exploration

Interrogate git rather than wandering the trees; three reads per worktree tell most of the story. If you can run sub-agents, fan out one per worktree and collect their findings; the reads are cheap either way.

- **The story:** `git log --oneline <trunk>..<branch>` — its own commits, subjects in order.
- **The shape:** `git diff --stat <trunk>...<branch>` (three dots: since the common ancestor) — which files, how much.
- **The loose ends:** `git -C <worktree-path> status --porcelain` — uncommitted and untracked work sitting in the tree.

Open actual files only where intent stays unclear after the three reads — and then only the few that dominate the diffstat, read from *your* checkout via `git show <branch>:<path>` rather than by entering theirs.

---

## 3. Reconstruct each effort's intent

From the branch name, the commit subjects, and the diff shape, state in one sentence what the effort *is* — "migrating the config parser to X", not "17 commits, 40 files". Uncommitted changes are part of the story: a clean tree with commits ahead reads as paused-or-done; a dirty tree reads as interrupted mid-thought. When the evidence genuinely doesn't say (WIP commits, scattershot diff), report *intent unclear* — an honest gap beats a confident invention, and the owner will know what it was.

---

## 4. Classify, and catch the collisions

Sort each worktree into the bucket its evidence supports:

- **Active** — recent activity, coherent trajectory. Leave it alone.
- **Ready to land** — clean tree, commits ahead, not behind the trunk. A graduation candidate; flag that its gate status is *unverified* (verifying would mean running it in their worktree — not yours to do).
- **Needs integration** — behind the trunk; its next move is `discern_integrate` run from inside it.
- **Stalled** — no recent activity, but real work sits in it (commits ahead, or a dirty tree). The ones most worth surfacing: they hold value that's quietly rotting.
- **Apparently abandoned** — old, empty of unique work, or visibly superseded by something that already landed. Say *why* you think so.

Then the check only a fleet-wide view can make: **intersect the changed-file sets** across branches (from the step 2 diffstats). Two efforts touching the same files are a semantic collision in the making even if both would merge cleanly — name the files, and note that whoever lands second must integrate with extra care.

---

## 5. Report, and recommend — never execute

Deliver one compact table — worktree, branch, ahead/behind, dirty?, last activity, intent, suggested next step — followed by the judgement in prose: what's ready to land (and a sensible landing order, collisions considered), what's stalled and worth rescuing, what looks abandoned, which pairs collide.

Recommendations are the owner's calls, so frame them as options: *graduate* (ready work), *integrate* (behind work), *resume* (stalled work), *discard* (abandoned work). For any discard candidate, first check — and say — exactly what would be lost: commits not on the trunk, uncommitted files, anything unpushed. Removal happens only by the user's explicit choice, never as part of the survey.

---

## Done when

- every worktree in the repository appears in the report, each with an **evidence-based intent** (or an honest *unclear*) and **one recommended next step**;
- ready / needs-integration / stalled / abandoned classifications are backed by the git evidence cited, with gate status marked unverified rather than assumed;
- **cross-worktree file collisions** are surfaced by name, with a suggested landing order;
- discard candidates come with a statement of **what would be lost** — and nothing, anywhere, was modified: no worktree entered as a workspace, no gate run in one, no cleanup performed.
