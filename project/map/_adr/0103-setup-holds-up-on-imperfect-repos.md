# ADR 0103: Setup grounds itself in the repo's real state — detected default branch, git-init-first without git, a welcome everywhere

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use the shared-branch label → the trunk; the decision and reasoning are unchanged. **Configuration amendment ([ADR 0153](0153-repository-owns-shared-checkout-convergence.md)):** Setup now stamps the detected branch into `[repository].trunk`; references below to `[project].main_branch` preserve the original schema spelling.

**Status**: accepted; builds on [ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md) (the served relay messages this makes honest), [ADR 0081](0081-setup-accept-command.md) (the landing command whose dead ends this closes), and [ADR 0100](0100-project-map-is-the-agents-map.md) (the single consent question whose promises this conditions)

## Context

Setup was written against a pristine repo — clean `main`, git present, identity configured — and the target user's repo is rarely that. Three of the resulting soft-degradations were structural, not cosmetic:

- **`main_branch` was hardcoded to `"main"` at scaffold.** On a `master` repo the gate's behind-main merge check found no local `main` and silently self-skipped forever — a protection the user believes is armed — and `setup accept` dead-ended on a branch that never existed.
- **A non-git directory soft-degraded.** `verify` filed a "Consider `git init`" advisory while the served consent message unconditionally promised the isolated `discern-setup` branch and worktree isolation — promises that are false without git, relayed verbatim to the human. ADR 0086 made the served messages load-bearing, which makes their honesty load-bearing too.
- **Bare `discern` outside a git work tree printed raw CLI help.** The restriction was documented as deliberate ("to avoid touching a stray dir"), but the welcome writes nothing, so there was nothing to avoid — and the users most likely to lack git are exactly the novices the curated first contact exists for.

A constraint surfaced during implementation forced a deviation from the drafted detection order (`origin/HEAD` → `init.defaultBranch` → current branch): vendor git builds bake a default into `init.defaultBranch` at a scope no environment variable masks — Apple's git ships `init.defaultBranch = main` in Xcode's built-in gitconfig. Consulting it ahead of the checked-out branch would stamp `main` on every macOS `master` repo: the exact bug the detection exists to fix.

## Decision

- **`begin` detects the repo's real trunk and stamps it into the fresh config's `[project].main_branch`**, in this order: the remote's declared default (`git symbolic-ref refs/remotes/origin/HEAD`), then **the branch checked out when setup started** (read before the `discern-setup` checkout; an unborn branch still names itself), then `init.defaultBranch` as a detached-HEAD tiebreaker only. The checked-out branch outranks `init.defaultBranch` deliberately — it is the repo's ground truth, while the config key is vendor-polluted (see Context) and, for unborn repos, already reflected in the unborn branch's name. Declarative `--config` fills apply after the stamp, so an explicit choice still wins.
- **`setup accept` on a missing trunk serves the exact creation-then-land step** (`git branch <target> && discern setup accept`) in the refusal message itself, on both surfaces — a brand-new repo's first commits are born on `discern-setup`, so the unborn target is a normal state, not a dead end. Land does **not** create the branch itself: a missing target can also be a misconfigured `[project].main_branch`, and silently creating a branch named by a typo is worse than one served command.
- **The non-git posture is git-init-first.** The consent context carries the git state, and every served promise conditions on it: without git the plan leads with `git init` (offered as its own consent point inside the fenced message), the unconditional branch-isolation sentence is replaced by its conditioned form, and the served next action is `git init` then re-running `verify` — never straight to `begin`. Setup does **not** require git: `begin` still proceeds in place if invoked without it, but no surface promises isolation it can't deliver.
- **Bare `discern` welcomes everywhere outside a set-up project**, including non-git directories, overturning the documented restriction. The welcome grounds itself in the git state and leads the non-git case with the `git init` step; explicit help remains one `--help` away.

## Consequences

- On `master`, `trunk`, and unborn-default repos, the merge check is armed from first setup and `setup accept` completes — the silent-self-skip class is closed at its source (the stamped config) rather than patched per consumer.
- A repo whose `origin/HEAD` disagrees with the local checkout follows the remote — the right call for clones, and the one case where the local branch is not ground truth.
- Setup run from a feature branch with no remote stamps that feature branch — the best available guess, and a visible, comment-adjacent config value the user can correct, where the old behaviour was an invisible wrong default.
- The consent surface now has two more grounded inputs (git presence, identity presence) whose combinations the parity tests must cover; the served-message fixtures grow accordingly.
- A stray `discern` in a random directory now shows a welcome rather than help. Accepted: the welcome writes nothing, names what discern is, and help remains reachable — the trade favours the novice over the operator, which is what a bare first contact is for.

## Alternatives considered

- **The drafted detection order (`init.defaultBranch` before the current branch).** Rejected on evidence: Apple's git bakes `init.defaultBranch =
  main` into an unmaskable built-in config, so the drafted order re-introduces the `master`-repo bug on every macOS machine. The user-preference reading of `init.defaultBranch` only adds signal when no branch is checked out.
- **`setup accept` auto-creates an unborn target.** Rejected: indistinguishable from a typo'd `[project].main_branch`, where auto-creation plants a wrong-named branch silently. The refusal serves the exact command instead.
- **Requiring git (refuse `begin` without it).** Rejected: git is not a hard requirement of an install (ADR 0081's landing summary already handles the no-repo case honestly); the failure was dishonest messaging, not the in-place path itself.
- **Keeping the bare-help restriction and printing a one-line hint.** Rejected: a hint is advice, and the audience is the one least equipped to follow it — the full welcome is the designed first contact and costs nothing to show.
