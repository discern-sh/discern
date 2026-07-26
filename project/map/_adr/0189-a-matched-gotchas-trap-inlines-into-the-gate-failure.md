# ADR 0189: A matched gotchas trap inlines into the gate failure

**Status**: accepted

## Context

The gotchas doc (`[project].gotchas_doc`) documents non-obvious gate failures as `###` trap entries (Symptom/Cause/Fix). When a gate verb fails, the failure tail prints a pointer to that doc — since the trackable-fetch work, a pasteable `discern map <target> --json` command — and the result envelope carries the same pointer as a hint. Consultation is therefore optional: the agent chooses whether to fetch, and the logbook shows the pointer is followed only sometimes. The project's stated principle is that a check documents itself at the point of failure; for a failure the doc already explains, the strongest form is to deliver the entry itself — recognition instead of recall.

Several seeded traps describe engine-produced failures with stable evidence: the timeout kill message, the exit-127 "command not found" message, and `failed_stage` values such as `tree_drift` and `tracked_artifacts`. That evidence is matchable mechanically. But the doc is prose owned by each project, the engine must not require any project to annotate it, and whatever annotation grammar ships becomes compatibility surface in every project's docs — hard to change once seeded.

## Decision

**A trap entry may carry a machine-readable matcher; when a gate failure matches one, the engine inlines that entry's body into the failure output on every surface.**

- **Syntax.** A matcher is a fenced code block with the info string `gotcha-match`, placed inside its `###` entry in the gotchas doc — one source of truth, adjacent to the prose it fires. The block body is TOML. `discern tidy` preserves fenced blocks byte-for-byte, so the annotation survives formatting. One matcher per entry; additional `gotcha-match` blocks in the same entry are malformed.
- **Vocabulary (v1, minimal — each field is compatibility surface).** Two keys, both strings:
  - `stage` — must equal the failure's `failed_stage` and must be a member of the closed failed-stage vocabulary (an unknown stage is malformed, so a typo surfaces instead of never matching);
  - `evidence` — a regular expression (JavaScript syntax; TOML literal strings avoid double-escaping) tested against each diagnostic's `message` and captured `output`.

  A matcher must carry at least one key. Both present means both must hold. Unknown keys are malformed — a misspelled key must not become a matcher that can never fire. Exit codes are not a matching input: the engine's own failure messages already name them (`exit 127`), so a pattern over evidence covers that case without growing the vocabulary.
- **Matching inputs.** The failure's `failed_stage` plus its `diagnostics[]` (message and normalized, capped output). Matching runs only when a gate verb (`done`, `prepare`, `test`) fails and a gotchas doc is configured.
- **Precedence.** Entries are tried in document order; the first match wins and at most one entry inlines. Document order is the author's ranking — no scoring, no ties.
- **Delivery.** The matched entry's title and body (matcher block excluded, bounded to a fixed cap) replace the generic pointer in the failure tail and in the envelope's `hints[]` — the channel both `--json` and MCP already carry — with the map fetch (or file path) kept as the route to the full page. Unmatched failures keep the pointer exactly as before. A project that never adds matchers loses nothing.
- **Malformed matchers surface at consumption time.** When the doc is consulted (a gate failure), each malformed matcher yields a warning naming its entry heading and the problem, on the human tail and in `hints[]`; matching continues with the remaining entries. Validation lives at consumption time because the doc is project-owned prose the engine cannot gate in every project; this repository additionally locks its own seeded matchers to the engine's real failure strings with a drift-guard test.
- **Explicit nos.** No new verbs, no auto-fixing matched failures, no per-project matcher configuration outside the doc itself, and no second copy of a trap: the inlined text is read from the doc at failure time, never compiled elsewhere.

## Consequences

- An agent whose run trips a documented trap reads the fix inside the failure it just received — identical on CLI, `--json`, and MCP — instead of deciding whether to fetch it.
- The `gotcha-match` info string and the `stage`/`evidence` keys are now shipped grammar. Widening the vocabulary is possible (a new key), but an older engine treats the new key as malformed and warns, so additions are deliberate and rare.
- A reworded engine failure message can strand a seeded matcher. In this repository the drift guard replays the engine's real messages and `failed_stage` values against the seeded matchers, so the reword fails the gate until the matcher moves with it. Other projects' matchers over their own tools' output carry the ordinary risk of any pattern: they degrade to the pointer, never to silence, and the malformed-matcher warning covers the grammar half of that risk.
- Inlining is bounded, so a very long entry truncates in the failure tail; the kept reference always reaches the full page.

## Alternatives considered

- **Frontmatter or a sidecar file for matchers.** Rejected: it separates the matcher from the prose it fires, creating a second place to update and a drift pair the parity discipline would then have to guard.
- **HTML comments as the annotation carrier.** Rejected: comment handling is renderer-dependent, and formatting tools make no byte-preservation promise for them; fenced blocks carry both guarantees already.
- **Substring matching instead of regular expressions.** Rejected: the timeout message interpolates the budget (`timed out after 30s`), so a single substring is either fragile or vacuous; a regex states the intended shape.
- **A `data` field instead of the hints channel.** Rejected: `prepare` and `test` carry no gate `data` payload, and the hints channel already reaches every surface with the pointer today; one channel, three verbs.
