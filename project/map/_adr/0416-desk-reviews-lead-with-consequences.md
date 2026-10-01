# ADR 0416: Desk reviews lead with consequences; the plan is one key away

**Status**: accepted; amends [ADR 0353](0353-desk-actions-are-registry-facts-reviewed-before-effects.md) (how a review is composed, focused and confirmed) and [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) (how the Desk teaches the command it runs)

## Context

A Desk review answered "what will this do?" by printing the lifecycle core's plan detail strings under a few registry sentences. The detail strings were written for the CLI's technical context: absolute paths, a padded "Authority: conversation required on apply" line, a queue listing by branch and revision. A person deciding whether to land had to read the plan to find the consequence, and nothing tied a sentence on the sheet to the fact that made it true, so a line could outlive its fact or claim an effect the task could not have.

Reviews were also held to their task only loosely. Apply re-read the fleet and compared the branch and identity, while the facts the review had shown (a new commit, a moved trunk, a grant recorded since) could change unseen. A sheet opened on its safe button only where the package happened to put focus, and a confirm could run before its consequences had been on screen.

## Decision

**A review is a pure projection with sourced lines.** [`review.ts`](../../../src/engine/desk/review.ts) builds every review from one registry offer or command, the observed task, and what the core's own preview found. Its lines come only from the registries' declared consequences, in registry order. Each declared line may name one fact from [`review_facts.ts`](../../../src/engine/desk/review_facts.ts); it shows only while that fact holds, and it carries that fact as its source: a status field, a preview fact, or, for a line naming none, its place in the registry. The sheet body is those lines and nothing else, and a test fails on a line whose source names nothing real.

**Previews report facts, not sentences.** The landing preview's `data.preview` and the Park, Drop and contained-checkout plans' subjects are typed facts: what lands with its commits and diff stats, whether and by how much the trunk moved, the authority, the queue walk, a landing it waits behind, the ignored roots it discards, and the grant and queue entry it ends. The Desk words these facts. The plan's detail strings stay the CLI's context lines and the technical plan's own text.

**Consequences first; mechanics one key away from any focus.** A sheet leads with its lines, then offers the changes (`v`), the exact shared `renderPlan` output of the same plan object the apply follows (`d`, or `^T` from a field), and the exact command with its actual flags (`c`, or `^X` from a field). An exception a landing needs opens with its command disclosure showing the exact hand-off.

**Sheets open on the safe choice.** A review opens on its safe button, or on its challenge field when it asks for one; Escape is the safe choice; letters never confirm. Drop asks for the branch name up front whenever its plan's blockers predict lost work, passes force only for a matched name bound to that plan, and offers Park instead one key away. Confirm stays disabled while any blocker remains (an exception, stale checkpoint answers, an invalid title) and until every line has been on screen. Unavailable actions never activate.

**Every mutating sheet binds what it showed.** Each registry `binding` names the facts the review captures as `expected`. Facts the observation reads (identity, branch head, trunk head, dirty stamp, grant and queue state, title, setup step) are re-read on every survey: one that moved puts the sheet in a Changed state with its words ("a new commit", "main moved") and keeps confirm disabled until `r` reads the review again. Apply re-observes first and refuses, re-opening the review, when one moved; facts only a preview knows (the reviewed revision, the whole Drop plan, a script's contents) go to the core or the effect, which compare them at their own boundary. A subject that leaves the inbox leaves only Close.

**Forms are reviews with fields.** Rename, New task, Start follow-up, Resume and a script's arguments are forms whose live preview is the same review, read again once typing pauses; their confirm applies exactly the preview of the values on screen. A failed effect becomes a result sheet: what stopped with its first diagnostics, what did not change, the next step in words, the full output and the command one key away, and up to two of the task's new next steps as keyed buttons.

**The command is one key away, not echoed.** Amending ADR 0119's "every action echoes its CLI command": the exact command is one key away in every review, recorded in Session activity, and printed to the terminal when the Desk exits.

**Flows are families.** [`flows/`](../../../src/engine/desk/flows/registry.ts) holds five family modules (landing, checkout, checks, start, children), each exposing a `review` and an `apply` per action or command. The landing flow is the only Desk importer of the grant writer and its cleanup.

## Consequences

- Adding a consequence means declaring a registry line and, when it depends on something, the fact it rests on; the sheet, the menu summary and the manual cannot drift from it.
- A guard holds every reviewed action and command to binding every fact its registry declares, and every action or command that asks first to exactly one flow.
- The CLI's preview contract gains additive structured fields; agents reading `accept --dry-run --json` get the same facts the Desk words.
- Reviews no longer show absolute paths or the queue's revision list on their face; those stay in the technical plan.
- A sheet's read progress and initial focus depend on the package starting a review over when a loading sheet becomes ready, so a sheet keeps one id throughout.

## Alternatives considered

- **Keep printing plan details under the registry lines.** Rejected: the person must parse technical context to find the consequence, and nothing ties the words to facts.
- **Humanize the technical plan itself.** Rejected: the disclosure must be the exact shared plan the apply follows; humanizing belongs in the consequence lines.
- **Open every sheet on its confirm button.** Rejected: a key typed for the list would answer the sheet; the safe choice must be the default.
- **Compare only branch and identity at apply.** Rejected: a review shows more than those, and any shown fact that moved makes the review stale.
