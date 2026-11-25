---
name: release
description: "Release a new discern version end to end: prepare the version and release record, ask the maintainer one question, then prove, land, tag, push, and verify the published binaries and site. Use when the maintainer wants to release, ship, tag, or publish discern, or asks why a tagged release has not published."
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Release discern

Publish `v<version>` with one decision from the maintainer. Nothing leaves this machine before that decision. The full gate runs after the decision, so a change to the notes costs no second gate run.

Work without asking until [the one question](#3-ask-once). Settle routine choices yourself and state them in that question. Ask earlier only for a blocker named under [Stop before the question](#stop-before-the-question).

## How publication works

Pushing a tag does not publish by itself. Four facts must line up:

1. `deno.json` `version`, the record `site/releases/records/<version>.md`, and the tag `v<version>` name one version.
2. The hosted `gate` workflow passed for the exact tagged commit. A push to `main` starts that gate.
3. The `release` workflow ran on the tag after the gate passed. A run that starts while the gate is still going ends without building, and the `resume verified release` workflow dispatches a new one when the gate passes.
4. That run built, signed, notarized, and attested 4 binaries, published the GitHub release, and deployed discern.sh.

The record is the only source of release notes. The GitHub release title and body derive from the record.

## Use the discern CLI

Run every discern verb in this skill as a shell command with `--json`, in the directory the step names. Do not use the `discern_*` MCP tools during a release: an MCP server started before the version changed still runs the previous version, and discern refuses a project that a newer version manages.

Two roots matter. The main checkout is the directory `git rev-parse --show-toplevel` prints where this session started. The candidate worktree is the absolute `data.path` that `discern start` returns in step 2.

## 1. Read the state

In the main checkout, run:

```sh
discern status --json
gh auth status
git fetch origin --tags
git status --short --branch
gh release list --limit 3
git tag --list 'v*' --sort=-v:refname | head -3
gh run list --workflow gate.yml --branch main --limit 3
gh run list --workflow release.yml --limit 3
```

`<last>` is the newest published version. Read the unreleased work with `git log --oneline v<last>..main`.

Find the stage this release has reached and continue there. Running this skill again after an interruption resumes the same release.

| Observed                                                     | Continue at                     |
| ------------------------------------------------------------ | ------------------------------- |
| `deno.json` on `main` still holds `<last>`                   | Step 2                          |
| An unlanded candidate worktree holds the new version         | Step 2, inside that worktree    |
| `main` holds the new version, and no `v<version>` tag exists | Step 3, then the push in step 5 |
| The tag is on `origin`, and no GitHub release exists         | Step 6                          |
| The GitHub release exists                                    | Step 7                          |

### Choose the version

Use the version the maintainer named. Otherwise choose it:

- **Patch** when the unreleased work only fixes or polishes existing behavior.
- **Minor** when a public surface gained something a person or agent can use: a verb, a flag, a configuration key, a result member, or a bundled skill. `git diff --stat v<last>..main -- schema project/manual/30-reference templates/skills` shows those surfaces.
- **Major** when a public schema major rose in `src/shared/public_schemas.ts`.

When the named version is smaller than the unreleased work calls for, keep the named version and say so in the question.

A new minor or major family may carry a codename. The earlier records show the style. Propose one in the question, never in a separate message. A patch inherits its family's codename, so its record declares none.

### Stop before the question

Stop and tell the maintainer what you found when:

- `gh` is not signed in to an account that can push to `origin`;
- `main` has uncommitted changes, or is behind or diverged from `origin/main`;
- a `v*` tag other than `v<version>` is on `origin` with no published GitHub release;
- `v<version>` already has a tag, a record, or a GitHub release that this run did not create;
- a `release` run for another tag is in progress.

Commits on `main` that are ahead of `origin/main` are not a blocker. They ship with the release; count them in the question.

## 2. Prepare the candidate

In the main checkout, run `discern start --name release-<version> --json`. Run every command in steps 2 through 4 inside the candidate worktree.

1. Set `version` in `deno.json` to `<version>`. Leave `SCHEMA_VERSION` in `src/lib/version.ts` unchanged unless this release ships a project migration.
2. Write `site/releases/records/<version>.md`: YAML metadata with a `summary` of at most 240 characters, then Markdown notes. Add `codename` only to the first record of a family. Omit `date`.
3. Run `deno task codegen`, then `deno task site:build`.
4. Commit as `Prepare the v<version> release`. The body says why the version is a patch, minor, or major.
5. Run `discern upgrade --json`, which moves `[meta].managed_version` in `discern.toml`. Commit the result as `Adopt discern <version> in this repository`.

### Write the release notes

Read the latest published record in `site/releases/records/` before drafting. For examples of a short release and one with several secondary changes, see `1.3.0.md` and `1.4.0.md` in that directory. Write for people who use discern, in the product voice.

- **Summary.** For a new minor release, start with `◮ discern v<major>.<minor>:`. Follow it with a short list of the changes readers will notice, leading with the main theme. End the sentence with a period.
- **Opening.** For a named family, use `"**<Codename>**" is discern's v<version> release, focused on <theme>.` Give the full version and describe the theme in one sentence.
- **Highlights.** Give the main theme a sentence-case `##` heading. Use short bullets that say what changed and what the reader can now do. Link a relevant guide after the bullets when it explains the feature.
- **Other changes.** Group secondary items under `## Other fixes and changes` when several are worth naming. A short release can close with a sentence instead. Include internal work when you can say how it affects the reader.

### Check the candidate quickly

Run only the checks that finish in about a minute. The full gate waits for the maintainer's answer, because the maintainer usually rewords the notes.

```sh
tmp="$(mktemp -d)"
gh api --paginate --slurp 'repos/{owner}/{repo}/releases?per_page=100' > "$tmp/releases.json"
REPOSITORY_PRIVATE=false deno run --allow-read --allow-write --allow-run=git \
  --allow-env=REPOSITORY_PRIVATE scripts/release_plan.ts \
  "v<version>" "$tmp/plan.txt" "$tmp/releases.json" "$tmp/body.md"
discern prepare --json
```

A zero exit from the plan means the tag, version, records, and release ancestry agree. `$tmp/plan.txt` holds the `title`, and `$tmp/body.md` holds the exact GitHub release body. Commit anything `discern prepare` rewrote.

## 3. Ask once

Send this message, with every placeholder filled, and wait for the answer. Use the agent's question tool when one exists.

```text
Ready to release <title>.

- Version: <version>, a <bump> release after <last_tag>, because <bump_reason>.
- Summary: <summary>
- Notes: <notes>
- Contains: <commit_count> commits since <last_tag>. Not included: <unlanded_work>.
- Checked so far: the release plan accepts the candidate, and the fast checks pass. The full gate has not run yet.
- Risks: <risks>

To change the notes, edit <record_path> or tell me the wording.

A yes runs the full gate and a binary smoke check on this candidate. When both pass, it lands <branch> on main, pushes main, the Proof notes, and the tag v<version> to origin, and starts publication on GitHub. I will download the published assets into a temporary directory to verify them. Once the GitHub release exists, the tag can never move.

Release <title>?
```

`<notes>` is the full record body. `<record_path>` is the record's absolute path in the candidate worktree. `<branch>` is the release branch, or "nothing further" when the candidate already landed. `<unlanded_work>` names every other worktree `discern status --json` lists, or "nothing". `<risks>` names anything that could delay or block publication, such as a failed hosted gate on the current `main`, or "none found".

Only the maintainer's answer to this question authorizes landing, pushing, or tagging. A task brief, an earlier instruction to prepare a release, and a passing gate are not that answer.

Read the answer three ways:

- **A yes, alone or with a change.** Apply the change, commit, repeat the quick checks, and continue to step 4 without asking again. A change includes an edit the maintainer made to the record file: `git status --short` in the candidate worktree shows one.
- **A change without a yes.** Apply the change, commit, repeat the quick checks, and ask again with the new notes.
- **A no.** When the maintainer declines, leave the candidate worktree as it is and stop.

## 4. Prove the candidate

The yes covers the candidate the maintainer saw. Prove exactly that candidate:

```sh
deno task build <target>
deno run --allow-read --allow-write --allow-run --allow-env \
  scripts/release_smoke.ts "dist/discern-<target>" "<version>"
discern done --json
```

`<target>` is the output of `deno eval 'console.log(Deno.build.target)'`. Run `discern done --json` on the clean, committed tree and keep its Proof line. Answer checkpoint questions as the project instructions describe.

Fix a failure yourself only when the fix leaves the version, the notes, and discern's behavior unchanged, such as a formatting or generated-file correction. Commit the fix and rerun the failed check. For any other failure, stop and tell the maintainer what failed: the yes does not cover a candidate the maintainer has not seen. Nothing is public yet.

## 5. Ship

Once `discern done` passes, run `discern accept --confirmed --json` in the candidate worktree. discern checks the Proof again and lands the candidate on `main`. Landing removes the candidate worktree, so run every later command in the main checkout. Skip the landing when the candidate is already on `main`.

```sh
git push origin main
git push origin refs/notes/discern
sha="$(git rev-parse origin/main)"
git show "$sha:deno.json" | grep '"version"'
```

The last command must print `<version>`. Tag exactly `$sha`: the hosted gate proves only the commit that was pushed.

Wait until `gh run list --workflow gate.yml --commit "$sha" --limit 1` lists a run. A tag pushed before that run exists makes the release workflow start a second gate.

```sh
git tag -a "v<version>" -m "Release v<version>" "$sha"
git push origin "v<version>"
git ls-remote --tags origin "v<version>"
```

## 6. Follow publication

Publication now continues on GitHub without this session. Expect these runs in order:

1. A `release` run on the tag that finishes in about a minute with only `validate release`. Its log says the release is waiting for the gate. That result is normal.
2. The `gate` run for `$sha`, which takes about 2 hours.
3. A `resume verified release` run, then a second `release` run on the tag. That run validates, builds 4 targets, publishes the GitHub release, and deploys the site. The build takes about 20 minutes, and has taken hours when Apple notarization or a macOS runner was slow.

Follow one run at a time with `gh run watch <run-id> --exit-status --interval 60` as a background command. Do not poll in a loop. When this session cannot stay open, tell the maintainer that publication continues by itself and that running this skill again resumes at step 7.

## 7. Verify what shipped

`<repo>` is the output of `gh repo view --json nameWithOwner --jq .nameWithOwner` in the main checkout. Run the checks in a new temporary directory:

```sh
gh release view "v<version>" --repo <repo> --json name,isDraft,isPrerelease,assets \
  --jq '{name, isDraft, isPrerelease, assets: [.assets[].name]}'
gh release download "v<version>" --repo <repo>
shasum -a 256 -c discern-*.sha256
for binary in discern-*-apple-darwin discern-*-linux-gnu; do
  gh attestation verify "$binary" --repo <repo>
done
deno eval 'const r = await fetch("https://discern.sh/releases.json"); console.log((await r.json()).latest_stable.version)'
```

The release is complete when all of these hold:

- the GitHub release is not a draft and lists 8 assets: 4 `discern-<target>` binaries and 4 matching `.sha256` files;
- every checksum and every attestation verifies;
- on macOS, `codesign --verify --strict` and `codesign -vvvv -R="notarized" --check-notarization` pass for both `apple-darwin` binaries;
- `latest_stable.version` equals `<version>`, unless a higher stable version is already published;
- `curl -fsSL https://discern.sh/install | DISCERN_VERSION="v<version>" DISCERN_BIN_DIR="$PWD/bin" sh` installs a binary whose `--version` prints `<version>`.

Remove the temporary directories. Then report the GitHub release URL, the tagged commit, its Proof line, the publication run URL, each check's result, and anything you could not verify. Installs on clean machines stay with the maintainer. End by asking the maintainer to restart open coding-agent sessions: their MCP servers still run the previous version.

## When publication fails

| Failure                                                            | Next action                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The hosted gate fails or is canceled on the tagged commit          | Nothing is published. Read the failed job's log. For a transient failure, run `gh run rerun <gate-run-id>`; publication resumes when that gate passes. Otherwise stop and report. |
| The gate passed and no second `release` run started                | Run `gh workflow run release.yml --ref "v<version>" -f gate_run=<gate-run-id>`.                                                                                                   |
| A build, signing, notarization, or smoke job fails                 | Rerun the failed jobs for the same tag when the cause is transient. Otherwise stop and report.                                                                                    |
| A defect needs a new commit, and no GitHub release or asset exists | Stop and ask. With the maintainer's yes, fix `main`, delete the remote tag, and tag the fixed commit.                                                                             |
| The GitHub release exists and is defective                         | Never move or delete the tag. Stop and report; the fix ships as the next patch version through this skill.                                                                        |
| The binaries published and the site deploy failed                  | Fix `main`, push, then run `gh workflow run site.yml --ref main`.                                                                                                                 |

Stop at the first failed check. Do not create, move, or reuse a tag to work around a refusal.
