# ADR 0365: The v1 CLI has one command model and one spelling

**Status**: accepted

## Context

The first public tag freezes more than the visible command names. Parent-level options determine whether a command is read-only or effectful. Result-envelope verbs and schema ids become integration contracts. Help, typo suggestions, Model Context Protocol (MCP) accounting, the manual, and exit statuses teach callers how to interpret the same tree.

Before v1, those projections had accumulated independent exceptions. `setup` could forward effectful options to `setup begin` while both shared one result identity. A hidden `preset` extension point carried dedicated manifests, environment controls, schemas, and fixtures despite having no public population. The interactive picker used a plural sibling of the `worktree` lifecycle group. Patterns used `archive` for an effect and `archives` for a listing. Nested help, JSON placement, helper commands, trailing-s folding, and exit-status tables each described a slightly different grammar.

The defect class is a command fact copied outside the typed live model, or an accepted spelling outside the canon that can teach an agent a second command. Pre-v1 compatibility does not justify carrying either into the public contract.

## Decision

**The typed live command tree is the authority for the v1 grammar, and every operation has one accepted spelling.** Registries derive the projections that need additional policy; tests enroll every command, option, result contract, and exit status.

- `discern setup` is the read-only welcome and progress view. `discern setup begin` is the effectful scaffold entry and owns every scaffold option. Each emits its own verb and result schema. A begin-only option on the parent refuses through normal command parsing and points to `setup begin --help`; it is never forwarded.
- The pre-v1 `preset` command is withdrawn in full: command, manifest, environment control, dedicated result and error contracts, documentation, fixtures, and tests. Shared config-document or overlay machinery remains only when another current feature uses it. No migration or replacement alias ships.
- `discern enter` is the interactive worktree picker. `discern worktree` remains the lifecycle-management group. The picker keeps its child-shell and project-relative directory behavior, but the old plural spelling does not dispatch.
- `discern patterns seal` is the confirmed action that seals active history. `discern patterns archives` remains the read-only listing. The old singular action spelling does not dispatch.
- `triangle`, `DiscernTriangleResult`, and `triangle --json` remain live. Hidden visibility does not mean dead or outside the result contract.
- Nested help resolves an arbitrary command path from the typed tree. Human help remains native command help. An explicit `--json` before or after `help` or its target returns one registered `help` envelope containing the same typed command model.
- `worktree ensure --json` is a pure registered result. Provider hook commands remain plain-text protocol entry points. Shell-only MCP membership derives from the command registry.
- Version flags share one exact output. Bare `discern --json`, malformed command boundaries such as `discern -- <verb>`, and usage errors return status 2. A single exit-status registry owns controlled statuses, including command-not-found 127 and signal-derived 129, and generates both manual tables.
- Typo suggestions derive from the live command tree. There is no grammar-wide trailing-s folding, command-specific compatibility redirect, or callable helper back door. The retired `init` and `install` words may appear only as suggestions to the read-only setup welcome.
- Descriptions, JSON-option wording, theme defaults, transport-flag visibility, and subcommand summaries belong to the command declaration or its explicit registry-backed projection, not hand-maintained copies.

The explicit *no*s are: no replacement aliases, no special-case refusal table for retired commands, no public preset migration, no parent-level setup effects, and no hand-maintained manual exit table.

## Consequences

- A v1 user and an agent see the same grammar in help, JSON, MCP accounting, schemas, and the manual. A removed spelling can only receive the generic unknown-command and model-derived suggestion behavior.
- Setup's option boundary now communicates its authority boundary before execution. Existing internal machinery may still be shared, but the public contracts are not.
- Removing preset forecloses a packaged stack-overlay feature at launch. A future extension point must be designed from demonstrated demand and introduced as a new public contract.
- The command model and registries become forcing functions: adding a command, JSON override, shell-only member, or exit status without its required projections fails tests or code generation.
- Exact version, help, and exit behavior is less permissive than the private-era surface. That is an intentional pre-v1 break with no public migration population.

## Alternatives considered

- **Keep aliases through v1 and deprecate them later.** Rejected because working aliases remain live suggestions to coding agents and create permanent dual-spelling test and documentation obligations for a population that does not exist.
- **Keep `preset` hidden.** Rejected because hidden commands still freeze schemas, environment variables, maintenance paths, and security expectations. Lack of current users is a reason to remove the surface, not conceal it.
- **Represent setup as one command with mode-detecting flags.** Rejected because a parent command that changes from read-only orientation to repository mutation based on an option obscures the consent and authority boundary.
- **Maintain separate human and JSON help implementations.** Rejected because they would describe independent trees. One typed model can project to both without changing the native human-help experience.
- **Keep exit statuses as prose.** Rejected because copied tables cannot enroll new controlled outcomes or prove that runtime selection and documentation agree.
