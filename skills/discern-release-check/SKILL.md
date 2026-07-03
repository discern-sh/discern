---
name: discern-release-check
description: Run release-prep and release-readiness checks for discern itself before a publish, tag, or release handoff. Use when the user asks to prepare, audit, verify, or check a discern release, release candidate, version bump, changelog, tag, GitHub release, npm/jsr/binary publication, or dist artifact for this repo. Internal to the discern repo; do not use for projects that merely have discern installed.
---

# Check a discern release

Release prep is verification by default. Do not publish packages, create or push
tags, cut a GitHub release, bump versions, or otherwise mutate release state
unless the user explicitly asks for that specific action.

## Checklist

1. Orient.
   - Call `discern_status` first and work only in your own isolated worktree.
   - Read current release-facing context before judging readiness: `AGENTS.md`,
     `guidance.md`, `docs/80-development/install-surface.md`, recent ADRs when
     the release touches architecture, and any version or release docs/scripts
     the repo currently contains.

2. Refresh and check currency.
   - Run `discern refresh` after edits to guidance, authored skills, bundled
     skills, or built-in guidance.
   - Verify `discern status --json` reports no stale generated agent files or
     stale materialized skills before calling the tree release-ready.
   - For this internal skill, edit only `skills/<name>/SKILL.md`; never edit
     `.agents/skills` or `.claude/skills` directly.

3. Regenerate derived config/docs artifacts when relevant.
   - If `src/shared/config_schema.ts` changed, run `deno task codegen` and
     include the regenerated schema and config reference docs.
   - If release-relevant behavior, install surface, commands, or workflow
     changed, update the affected docs or ADRs in the same change.

4. Run the gate.
   - Run `discern_finish` on the intended final tree and fix every diagnostic.
   - Treat a green `discern_finish` as necessary, not sufficient: release prep
     also needs the extra checks below.

5. Run ratchets.
   - Run `discern_ratchets` or `discern ratchets --json` on demand before a
     release recommendation.
   - Never loosen a ratchet to pass; improve the metric or escalate the real
     decision to the user.

6. Build and inspect distribution artifacts.
   - Run `deno task build`.
   - Inspect `dist/` after the build: confirm expected binaries/artifacts exist,
     names look release-ready, sizes are plausible, and no stale or surprising
     files were left behind.
   - Do not use `dist/` binaries for development verification; build them only
     as release artifacts to inspect.

7. Check version, tag, and release workflow readiness.
   - Identify the intended version and compare it with any version constants,
     package metadata, changelog/release notes, existing git tags, and release
     automation files present in the repo.
   - Confirm the tag name and release notes plan are consistent with project
     history before recommending a release.
   - If checking remote state, use read-only commands unless the user explicitly
     asked to push, publish, tag, or create the release.

## Done when

- `discern_status` is current and the work is in an isolated worktree;
- generated agent files and materialized skills are fresh;
- any relevant codegen, docs, or ADR updates are included;
- `discern_finish`, ratchets, and `deno task build` pass;
- `dist/` and version/tag/release workflow checks have been inspected and
  summarized;
- no publish, tag, push, version bump, or release-state mutation happened
  without explicit user instruction.
