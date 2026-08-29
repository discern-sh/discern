---
title: Checkpoint recipes
description: Copyable checkpoint triggers for common review moments, with advice on stop and advise modes.
order: 170
aliases:
  - checkpoint recipe gallery
  - checkpoint examples
---

# Checkpoint recipes

_Start with a real review question, then choose the narrowest structured trigger that introduces it._

These entries combine fields from [trigger composition](checkpoints.md#trigger-composition). Copy one into `discern.toml`, replace the generic paths and literal patterns with the project's authorities, and let it govern new efforts after landing. Use `stop` when every match deserves a recorded answer before the Gate. Use `advise` when the selector is a useful heuristic or an omission can be legitimate without owner ceremony. The [config reference](https://discern.sh/docs/reference/config-reference#checkpointsname) is the field authority.

## Source change without tests

```toml
# Stop when every source-only change must account for regression coverage.
# Change to advise if the source/test path split is only a heuristic.
[checkpoints.source-without-tests]
paths = ["src/**"]
unless_changed = ["tests/**"]
mode = "stop"
question = "Does this source change have equivalent regression coverage, or a concrete reason tests do not apply?"
```

## Substantial change without a release note

```toml
# Advise because a large internal change may need no public release note.
[checkpoints.release-note]
paths = ["src/**"]
unless_changed = ["CHANGELOG.md", "docs/releases/**"]
min_changed_lines = 200
mode = "advise"
question = "Does this substantial change alter behavior that belongs in the changelog or a release note?"
```

## CI workflow change

```toml
# Stop when every pipeline change must explain its trust and failure behavior.
[checkpoints.ci-workflow]
paths = ["ci/**"]
mode = "stop"
question = "Does this workflow preserve required checks, least privilege, pinned inputs, useful failure output, and a practical local verification route?"
```

## Newly added ADR

```toml
# Advise on the decision moment without interrupting later editorial fixes.
[checkpoints.new-adr]
paths = ["docs/decisions/**"]
kinds = ["added"]
mode = "advise"
question = "Does this new decision record state the decision, real alternatives, consequences, and enduring reason?"
```

## Newly created directory or subsystem

```toml
# Advise because a new parent directory is a useful subsystem heuristic.
[checkpoints.new-subsystem]
paths = ["src/**"]
kinds = ["added"]
new_directory = true
mode = "advise"
question = "Does this new directory establish one clear responsibility, an owner or entry point, and boundaries that prevent a parallel implementation?"
```

## Public API surface

```toml
# Stop when every public contract change needs compatibility judgment.
[checkpoints.public-api]
paths = ["src/public/**"]
mode = "stop"
question = "Is this public contract compatible under the project's policy, with failure behavior, migration, and documentation addressed?"
```

## Added or removed user-facing error copy

```toml
# Advise on either direction. Replace "error" with the project's stable marker.
[checkpoints.error-copy-added]
paths = ["src/messages/**"]
adds_matching = ["error"]
mode = "advise"
question = "Is this user-facing error specific, actionable, consistent with product terms, and free of sensitive detail?"

[checkpoints.error-copy-removed]
paths = ["src/messages/**"]
removes_matching = ["error"]
mode = "advise"
question = "Does removing this user-facing error preserve a clear failure explanation and next valid action?"
```

## Dependency declaration change

```toml
# Advise because manifest edits can add, remove, pin, or update dependencies.
[checkpoints.dependencies]
paths = ["dependencies/**"]
mode = "advise"
question = "Is each dependency change needed, permission-compatible, maintained, pinned under project policy, and reflected in reproducible installation data?"
```

## Security-sensitive paths

```toml
# Stop when every change in owner-designated sensitive regions needs a review record.
[checkpoints.security-sensitive]
paths = ["src/security/**", "config/access/**"]
mode = "stop"
question = "What trust boundary changes here, what could expose data or authority if it is wrong, and which test or review evidence addresses that risk?"
```

A plausible declared-unmet outcome is that `public-api` fires while the compatibility note depends on an owner choice between deprecation and immediate removal. Record that dependency in the short `--why` rationale. The owner then decides whether to authorize the named variance.
