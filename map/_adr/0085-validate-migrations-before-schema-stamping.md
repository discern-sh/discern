# ADR 0085: Migrations validate before schema stamping and refuse newer configs

**Status**: accepted

## Context

The migration chain is discern's upgrade safety story: a project records
`[meta].schema_version` runs every pending step, then stamps the project as
current. ADR 0014 already says the migrated result must be validated before
stamping, but the implementation did not enforce that boundary. A
comment-preserving TOML edit could leave `discern.toml` syntactically invalid or
schema-invalid, while `upgrade` still exited successfully and stamped the
current schema. Every later command would then fail on the user's now-current
but unreadable config.

The same boundary was missing in the other direction. A project written by a
newer binary records a schema version greater than this binary supports. The old
binary has no migration to run, because `pendingMigrations(newer, older)` is
empty, so it treated the install as up to date and a full `upgrade` stamped the
recorded version down. That silently converted "you need a newer binary" into
"your current config is malformed," pushing the user toward deleting valid newer
keys.

Guideline compilation has a different failure model. ADR 0065 deliberately made
per-artifact guidance failures non-fatal so one blocked generated file does not
prevent the rest of setup or refresh from completing. Config validity is not the
same kind of work: a bad `discern.toml` breaks the command surface itself, so it
cannot share that soft-failure semantics.

## Decision

`upgrade` proves the migrated `discern.toml` parses and validates against the
current schema before it recompiles guidance or stamps `[meta].schema_version`.
If validation fails returns a hard `invalid_migrated_config` failure and leaves
the recorded schema untouched. The migration's partial file edits may still be
present, but the project is not marked current; a fixed, idempotent migration
can be re-run from the same recorded version.

A recorded schema greater than this binary's `SCHEMA_VERSION` is a hard forward
skew refusal on every migration-status surface: `upgrade`, `upgrade --check`,
and `upgrade` all return `schema_version_too_new` with the user-facing message
"this project needs a newer discern — re-run the installer." They do not compute
a pending set, do not report "up to date," and do not stamp the schema down.

The explicit no: guideline refresh failures remain non-fatal after config
validity is proven. Config validity is a prerequisite for stamping; generated
guidance is a refresh artifact whose failures are reported but isolated.

## Consequences

- A migration bug can no longer create a stamped brick. The user may still need
  a fixed binary to repair a partially edited config, but discern does not hide
  the failure behind a current schema number.
- Older binaries fail accurately on newer installs. The recovery advice is to
  update discern, not to delete config that may be valid for the newer schema.
- Migration tests now include an executable validity net: migration outputs are
  parsed, full upgrade-corpus entries validate with zero schema issues, and a
  deliberately invalid synthetic migration pins the hard-failure behavior.
- The cost is that `upgrade` can now fail after migration steps have written
  files but before guidance refresh or schema stamping. This matches the
  existing idempotent-chain design: the recorded schema remains behind, so the
  repaired chain replays rather than skipping the failed step.

## Alternatives considered

- **Warn but do not stamp.** Rejected because a warning still exits through a
  successful-looking path and asks callers to infer that the install is not
  current. A config that cannot be read is the hard failure the migration system
  exists to prevent.
- **Validate only TOML syntax.** Rejected because schema-invalid TOML is still
  unusable to the current engine. The proof must be the same parser and schema
  every later command will use.
- **Let newer configs pass as "up to date."** Rejected because an older binary
  cannot know that no migration is needed. A monotonic schema version is only
  meaningful if forward skew refuses instead of pretending compatibility.
