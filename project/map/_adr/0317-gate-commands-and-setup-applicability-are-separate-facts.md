# ADR 0317: Gate commands and setup applicability are separate facts

**Status**: accepted; extends [ADR 0168](0168-the-gate-declares-jobs.md) and preserves the schema-v1 result boundary of [ADR 0208](0208-public-contracts-version-by-schema-major.md) and [ADR 0220](0220-self-supplied-commands-count-for-nothing-in-assurance.md)

## Context

Known jobs accept either one command or an ordered list under `[jobs]`, but `discern config set-job` could author only the scalar form. Setup agents that needed a project formatter followed by `discern tidy` had to edit TOML directly. Worse, a plausible serialized array passed positionally was valid as one literal string, so a dry run could preview a syntactically valid configuration that later tried to execute the array notation as a shell command.

Setup assurance had a different ambiguity. An omitted known job meant only "no command is configured." It could not say whether setup had missed a protection that should exist or the project had no such lifecycle. Treating every known name as applicable made a project with five real protections and no build lifecycle read as partial five-of-six.

The two facts have different effects. A job command controls Gate execution. Lifecycle applicability controls only the setup coverage denominator. Inferring one from the other would make omission ambiguous again, while putting an applicability switch inside a job value could make a coverage declaration look capable of suppressing execution.

The public schema-v1 row state is also closed as `enforced | deferred | absent`. A fourth `not_applicable` state would break exhaustive consumers. Existing summary consumers expect `full` to mean `enforced === total`, so retaining the canonical known-job count in `total` while excluding a row from the verdict would make the old fields contradict one another.

## Decision

`[jobs]` remains the sole authority for Gate commands. `discern config set-job <known> --run <command>` is repeatable; one invocation replaces the job with the supplied commands in order. The positional form remains the compatible scalar form. A call cannot mix the positional command with `--run`. An empty `--run`, a missing option value, or a positional string that parses as a serialized string array is refused with one corrected invocation. Dry run and apply use the same read-only edit plan and the comment-preserving TOML editor.

Setup applicability lives separately:

```toml
[assurance]
  not_applicable = ["build"]
```

Every `KNOWN_JOBS` member is applicable unless it appears in this list. `discern config set-job <known> --not-applicable` adds an absent lifecycle; `--applicable` removes it. Custom names are invalid. Any configured value under `[jobs]` contradicts an inapplicability declaration, including an empty command, a no-op, or discern-only housekeeping. The config validator rejects that shape. Setting a real, no-op, scalar, or ordered command automatically removes the declaration in the same planned edit.

Applicability never enters the Gate planner. It cannot skip a configured known job, custom job, scope gate, Standard, checkpoint, or any other execution surface.

Setup assurance continues to classify every canonical row as `enforced`, `deferred`, or `absent`. An inapplicable row is represented additively as `state: "absent", not_applicable: true`. The summary emits:

- `enforced`: applicable rows that carry a project command;
- `total`: the applicable denominator;
- `known_total`: the complete `KNOWN_JOBS` population;
- `not_applicable`: the number of excluded rows;
- `verdict`: `full` when every applicable row is enforced, `partial` when some are, and `minimal` when none are.

`known_total`, `not_applicable`, and the row marker are optional in the runtime result schema so older schema-v1 shapes still validate; current producers always emit them. Reusing `total` for the applicable denominator keeps the existing compatibility invariant coherent: an older consumer reads a full five-of-five result, while a newer consumer can also account for the sixth row. When no known protection applies, the verdict is vacuously `full`, and human output states that no known protections apply rather than implying that checks run.

## Consequences

Setup agents can author a scalar or ordered known-job value without leaving the supported command surface. Literal argument bytes and order survive command parsing, TOML editing, config loading, planning, preview, and Gate execution. The command owns one extra ambiguity rule: a positional serialized list is no longer a legal scalar even if a shell could theoretically use that exact text.

Applicability becomes an explicit project assertion rather than a repository heuristic or comment. A new known job automatically joins the list's enum and assurance as applicable and absent, so it lowers coverage until configured or deliberately excluded. Contradictions fail at config load and at the supported write boundary.

Schema-v1 consumers retain the closed row state and coherent legacy counts. Consumers that need to distinguish applicable absence from inapplicable absence read the additive marker and counts. This is a compatible output extension, but it deliberately changes `total` from the canonical population to the verdict denominator; the invariant is more useful to older consumers than retaining a count whose verdict meaning no longer agrees.

The cost is a second top-level config section and an explicit owner/setup-agent judgment. Projects must record lifecycle absence rather than receive a guessed answer. That ceremony is the safeguard that keeps the Gate command and the coverage claim independent.

## Alternatives considered

**Infer inapplicability from an omitted command.** Rejected because omission is the very ambiguity setup assurance needs to expose: it can mean either a lifecycle does not exist or setup is incomplete.

**Put `applicable = false` inside `[jobs.<name>]`.** Rejected because `[jobs]` is execution authority. A non-executing entry there would blur absence, deferral, and execution suppression, and could make applicability affect the Gate.

**Add `not_applicable` to `KnownJobState`.** Rejected within schema v1 because the public enum is closed. A future result-schema major may adopt a fourth state and reconsider the summary fields if the migration value exceeds the compatibility cost.

**Keep `total` equal to `known_total`.** Rejected because `full` would then no longer mean `enforced === total` for older consumers. The additive `known_total` field preserves the canonical population without making the compatibility fields disagree.
