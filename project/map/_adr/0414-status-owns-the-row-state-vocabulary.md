# ADR 0414: Status owns the row-state vocabulary

**Status**: accepted; amends [ADR 0318](0318-the-desk-adapts-status-into-one-human-decision.md), refines the row projection of [ADR 0255](0255-status-is-a-measured-responsive-dashboard.md)

## Context

Three human surfaces described the same fleet row in three vocabularies. `discern status` kept a label, glyph, tone and priority per status kind and a separate next-step sentence; `discern enter` showed the Desk's headline and details, ordered by activity; the Desk derived its own headline from Proof facts and sorted alphabetically. For one task with honored Proof, 1 commit ahead, 361 behind and 11 days idle, status read "! Stale" while the Desk showed a green "Proof valid". Status's own ready-for-review hint listed the same task as ready, beside the row that called it stale.

The status kinds were too coarse to carry what a person decides next. One `blocked` kind covered a consent wait, an exception wait and an ordinary refusal; one `running` kind covered checks, a landing and an update; one `ready` kind covered work awaiting approval, pre-authorized work and work already queued. A landing's integration copy showed as a separate row although the task it landed was the thing happening. Refining these inside each surface would recreate three precedence tables.

## Decision

Status owns one closed table of row states, beside its classifier. `classifyRowKind` keeps its closed kinds; `rowStateFor(kind, entry, { queueRow, integration, proofData })` refines a kind into exactly one state by a written precedence, first match wins:

1. degraded kinds, split by the setup record;
2. an integration copy landing this task: live is Landing, a copy retained for the owner's variance is Exception, a copy retained for the agent's checkpoint answers is Refused, a dead owner is Interrupted;
3. a running verb (`done` Checking, `accept` Landing, `update` Updating, else Running);
4. a failed verb (`done` Checks failed, `accept` Didn't land, else Failed);
5. a refusal, by the `last_action.error` slug while the work can still land: variance or standard approval waits are Exception, a consent wait is Wants to land, else Refused;
6. stale, with honored Proof kept as its own state, except that a clean contained branch stays Contained;
7. editing;
8. ready, by Proof exceptions, then the queue row's `awaiting-owner` authority, then recorded authority (Queued #N, Approved), else Ready;
9. containment, then the behind and Proof kinds;
10. idle, as Empty or Idle; a clean task with nothing ahead is Empty even when the trunk has moved.

Each state has a group, a label of at most 13 cells, a glyph with an ASCII form unique within the state column, glyph and label tones, and two headline facts. Green is reserved for states that can land. The groups are `FLEET_ROW_DECISIONS` (Ready for review, Needs attention, Working, Approved to land, Idle) and `FLEET_BRANCH_GROUPS` (Parked, Landed). Each state builds a qualifier and two sentences: `explanation` in the human register with no commands, and `attention` in the CLI register with the exact command. The human wording of Proof, landing authority and queue place is built once beside them; "scope limited" and "authority unknown" never reach people. An exception's hand-off is derived per kind: `discern accept --target <branch> --confirmed`, one `--variance` per unmet checkpoint and one `--approve-standard` per standard proposal, with the token acceptance serves; a retained composition contributes its own awaited ids and `--composition-receipt`, which status publishes on the copy's `integration.judgment`. When no fact names the decision, the hand-off names only `discern accept --target <branch>`, which serves it, rather than a command that would be refused.

`presentFleetRow` returns the state, group and look beside the status kind. The status dashboard groups rows by decision with case-folded titles inside, and `discern enter` lists tasks the same way with the same labels. The Desk's redesign reads the same table. Fleet hints that name ready, authorized or stale tasks take their members from the state, so a hint and the row it names cannot disagree.

Structured status gains additive `state` and `group` on each task row, published as open vocabularies; `landing_authority` and every other wire shape stay as they were. `last_action` gains the envelope's `error` slug, and it ignores completions the verb registry classifies as observation and `--dry-run` previews, so an agent's `discern status` or a landing preview no longer replaces a failed Gate.

### Amendment to ADR 0318

ADR 0318's `DESK_STATE_BY_STATUS_KIND` mapping and its rule that a known positive behind count disables Accept and recommends Update are stale: ADR 0398 removed the mapping and recommendations, and honored Proof can still land behind the trunk because acceptance composes the moved trunk itself. Its central decision stands and is reaffirmed: one classifier, owned by status, which no other surface repeats. This record moves the human vocabulary to that same owner.

## Consequences

`discern status`, `discern enter` and the Desk show one word, glyph and group for a row, and a label change happens in one place. The matrix test enumerates every kind-deciding fact and every refining fact against the written precedence, so a new kind, state or rule cannot enter without its fixture.

Status's human output changes visibly: labels such as Needs checks, Checking and Editing replace Needs gate, Gate running and In progress; rows group by decision instead of priority; and a landing's integration copy no longer has a row while its task does. Agents reading the wire see two new fields and a `last_action` that skips observations. The ready and stale hints no longer list a task whose setup is incomplete, because that task's state is Needs setup.

Containment resolves before staleness and before the behind and Proof kinds, a departure from a literal idle-only rule: a contained branch carries commits without its own Proof and idles by design while a later task carries them on, so it would otherwise read as Needs checks or Stale and never offer its reclaim.

The table lives in three pure modules (states, sentences, facts) rather than one, so none of them joins the complexity tail. The stale-and-pre-authorized case keeps its stale state and says it may land with the next landing; the queue fact stays visible.

## Alternatives considered

- **New status kinds for each refinement.** Rejected: kinds drive the classifier's precedence and the Desk's parity; churning them would ripple through every consumer when a refinement over the existing kinds is enough.
- **A Desk-local table.** Rejected: it recreates the drift that produced "Proof valid" on a stale task.
- **Prefer `last_action.error` over the queue row for Wants to land.** Rejected: an agent's next command overwrites `last_action`, while the queue's `awaiting-owner` authority is durable.
