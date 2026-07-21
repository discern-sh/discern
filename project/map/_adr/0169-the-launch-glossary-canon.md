# ADR 0169: The launch glossary canon

**Status**: accepted

## Context

[ADR 0018](0018-vocabulary-consolidation.md) first reduced discern's public vocabulary, [ADR 0120](0120-launch-verb-canon.md) fixed the launch naming rule, and [ADRs 0164](0164-glossary-compiles-from-a-term-registry.md) and [0167](0167-term-registry-polices-the-vocabulary.md) made the glossary executable: one registry generates the page, retired synonyms become searchable aliases and drift checks, closed sets must enrol or record their absence, and live usage is held at zero debt.

That machinery could keep a settled canon consistent, but it could not decide whether the canon itself was coherent. The launch review found duplicate names for one referent, terms named after production mechanisms, a shifting pronoun used as a term, a noun that disagreed with its verb, and entries that defined ordinary English or config containers rather than product concepts. It also found the same never-blocks promise repeated across coupling, patterns, and command descriptions. Those repetitions were already beginning to drift.

The review also tested five established names that looked replaceable in isolation. Each had a stronger system-level reason to stay. Recording those keeps matters as much as recording the renames: otherwise the next vocabulary pass reopens settled choices without the context that decided them.

This is the final glossary canon before launch. It follows ADR 0120's retirement boundary: a retired product name is policed where it acts as a name, never as an ordinary prose word.

## Decision

**Give each product concept one stable name, remove entries that are not product concepts, and record both the changes and the deliberate keeps as the launch glossary canon.**

### Rename or merge seven entries

| Previous entry      | Launch entry       | Reason                                                                                                                                              |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary version      | discern version    | Names whose version it is and distinguishes the binary's semantic version from the project's schema version.                                        |
| Co-managed seed     | Shared file        | Names the tracked object and its ownership relationship. “Seed” had already been retired by ADR 0018 and wrongly implied write-once setup material. |
| Co-change advisory  | Coupling           | Shares the noun with `discern coupling`. Advisory is the mode, not a second name for the finding.                                                   |
| Compiled agent file | Agent file         | Names the thing readers use, not one production mechanism.                                                                                          |
| File dispositions   | File ownership     | States the user-facing question the buckets answer.                                                                                                 |
| Your files / Yours  | Project-owned file | Gives agents and readers a stable noun instead of a pronoun whose owner shifts with the speaker.                                                    |
| The binary's files  | Generated file     | Merges two entries that named the same set. Generated file is the sole name for materialized skills and agent files.                                |

The coined previous names become `retired` registry data with inflection-aware patterns: binary version, co-managed seed, co-change advisory, compiled agent file, file dispositions, and the binary's files. The generated aliases keep old-name searches working while the drift guard keeps the phrases out of live prose.

“Your files” and “yours” do not retire as English. The trust page keeps “your files stay yours,” because the sentence is clearer and warmer than a forced product term. “Co-managed” also remains legal as an adjective. The registry retires coined names, not useful prose words.

The ownership definitions now form one system under File ownership. A Project-owned file is written once and left to the project. A Shared file is tracked and shared with discern: `discern.toml` and the marked `.gitignore` block, with discern owning only its marked regions. A Generated file is an agent file or materialized skill, safe to overwrite because its reviewable source belongs to the project; drift from that source fails the gate.

### Remove four non-concepts

Surface, Test, Readiness, and Worktree settings leave the registry. Surface and test are ordinary words whose meaning comes from their modifier or position. Readiness merely renamed `doctor`'s result. Worktree settings grouped config keys without naming a product concept; the worktree and config documentation carry the useful rule directly: identity-dependent setup belongs to linked worktrees, while checkout-generic convergence belongs in `[repository].ensure`.

Removal does not ban a word. It removes the glossary entry, anchor, hover target, and usage obligation. Any live link to a removed anchor must point to the owning concept or explanatory page instead.

Closed-set members still require an explicit vocabulary decision. `verb:doctor` and `verb:test` join `DELIBERATELY_ABSENT`: their behavior belongs in the Installer, Gate job, Stage, and CLI documentation rather than padded glossary entries. The existing `verb:mcp` reason now points to transport documentation instead of the removed Surface entry. Enrolment is set-aware, so the `test` job and `test` stage do not silently enrol the same-named verb.

### Add the two missing class terms

**Advisory** is the class for read-only findings from coupling, patterns, impact, and improvement. An advisory points and never blocks; the gate and standards are the only enforcement surfaces. Instance entries link this definition instead of restating the promise.

**Fleet** is the set of worktrees the desk surveys and `discern status` reports from the main checkout. The Desk entry links the term rather than relying on an undefined metaphor.

### Correct five definitions

The Shared file and Generated file definitions carry the complete ownership truth established by their rename and merge. Three existing entries also change without changing names:

- **Installer** is the group of verbs that install and maintain discern in a project: `setup`, `upgrade`, `doctor`, `config`, and `preset`. Some inspect and some write; `doctor` is read-only. They run and exit, and discern is never a runtime dependency of the project.
- **Standard** is held against the trunk on every gate run. Untouched `inputs` replay the recorded value, and `measure = "on-demand"` defers measurement to `discern standards`; only the never-loosen limit check is unconditional.
- **Update** complements accept. Update brings trunk into the branch; accept lands the branch on trunk. Calling them inverses suggested a reversibility neither operation has.

Generator-owned descriptions use the same canon. Command, config, and path registries say Agent file, Guidance source, Coupling, and Advisory; code generation carries those names into the CLI and config references.

### Keep five reviewed names

The review deliberately keeps these names:

- **Stage.** It has the continuous-integration prior users expect beside jobs. `failed_stage` is also frozen into logbook history, and ADR 0017 deliberately retired “phase.”
- **Logbook.** “History” collides with coupling's Git-history vocabulary and reads worse on the trust page. Logbook names the local, append-only evidence without implying source history.
- **Worktree resource.** Resource has the provisioning prior the lifecycle needs. “Dependency” reads as a software package and obscures creation and teardown.
- **Placement is consent.** This is a named law that pages cite, not a decorative slogan. Removing the entry would stop the vocabulary guard policing bold restatements of the law.
- **Namespace.** The term is precise, familiar to agents, and more legible than a product-specific substitute for the configured authored-source directory.

These keeps are part of the canon. Later work may change how the registry separates matching phrases from display text, but it does not reopen these names. Matching and display control are deliberately deferred to the later registry stage.

## Consequences

- A reader encounters one name per concept. Searching a retired coined name still lands on the generated glossary through its alias, but live public prose cannot teach that name again.
- The never-blocks promise has one definition under Advisory. Coupling and Patterns name their behavior and link the class; command descriptions can route to it without duplicating policy.
- File ownership reads as three complementary buckets: Project-owned, Shared, and Generated. The exhaustive structural proof remains separate work; this decision fixes the vocabulary it will prove.
- Removing an entry is intentionally cheaper than retiring a coined phrase. Ordinary uses of surface, test, and readiness stay legal, while dangling links and closed-set enrolment still fail mechanically.
- The registry, generated glossary, generated references, live map, and source descriptions move together. Vocabulary debt remains zero, so every new term must have a live use and no page may redefine it in bold.
- Historical ADR bodies retain the vocabulary they recorded until the reviewed decision-record refresh. This ADR is the decision of record that refresh can cite.

## Alternatives considered

- **Keep both The binary's files and Generated file.** Rejected because they had one referent. Two definitions would force readers to infer a distinction the implementation does not have.
- **Keep mechanism-shaped and pronoun-shaped names.** Rejected because compiled, binary, your, and yours change meaning with implementation or speaker. Stable object names survive both changes.
- **Retire every removed word and every phrase containing “your.”** Rejected by ADR 0120's boundary. The product retires names in naming positions, not ordinary English; broader patterns would damage clear prose and produce false positives.
- **Replace stage, logbook, worktree resource, Placement is consent, or Namespace while sweeping the rest.** Rejected for the priors, historical compatibility, enforcement role, and agent legibility recorded above. A sweep is not a reason to rename a term whose system fit remains strong.
- **Add display and matching fields now.** Rejected as a separate registry concern. The launch canon can land through the existing term, retired-synonym, alias, and drift machinery; a later stage owns display and hover matching without changing these decisions.
