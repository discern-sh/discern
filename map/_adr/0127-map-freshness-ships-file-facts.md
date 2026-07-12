# ADR 0127: Map freshness ships file-linked facts, not verdicts

**Status**: accepted

## Context

The no-argument map overview originally treated any tracked path beneath a
linked path as covered. Orientation pages often link broad directories such as
`src/`, `src/engine/`, and `templates/`, so unrelated work anywhere below them
made a region read `behind`. Four minutes after one disciplined landing, five of
this repo's eight regions read `behind`, including pages updated eleven minutes
earlier.

That verdict was least useful on the agent-facing JSON surface. It carried no
calibrated threshold, while `code_paths` exposed the entire inferred coverage
set. The review payload was 12,201 bytes, about half of it the regions block and
roughly 4 KB of that path lists.

## Decision

A region's freshness coverage consists only of the specific tracked files its
pages link. A directory link is an orientation gesture, not evidence that the
region documents every descendant.

Each serialized region carries `pages_changed_at` and `code_changes_since`
directly when Git can derive both facts. Both fields are absent when freshness
is unknown. The wire carries no status, threshold, sentinel, or coverage paths.
The human view renders the same facts or a short unknown line from that shared
shape.

No interpretive verdict will return until repository evidence can calibrate one.
Facts are additive-safe; a prematurely shipped semantic would be costly to
correct after clients depend on it.

## Consequences

- Regions that cite only directories, or cite no tracked files, honestly report
  unknown freshness instead of inheriting changes from an entire subtree.
- CLI JSON and MCP stay identical because both render the same result core and
  schema. Their payload is smaller and no longer tells an orienting agent to
  distrust the map it was sent to consult.
- File links now do double duty as navigable documentation and precise freshness
  coverage. Pages that need freshness facts must cite the files that ground
  their claims.
- Commit count remains the measurement grain. Removing the verdict de-fangs its
  atomicity penalty while leaving future calibration open.
