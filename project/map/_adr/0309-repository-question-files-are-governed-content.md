# ADR 0309: Repository question files are governed content

**Status**: accepted; extends the merge-base policy authority of [ADR 0294](0294-the-merge-base-governs-checkpoint-policy.md)

## Context

Inline checkpoint questions keep ordinary policy visible in `discern.toml`, but a substantial rubric can make the table harder to read and maintain. Some projects also keep review prose in a repository document. Treating a `question` string that happens to end in `.md` as a path would make short prose ambiguous. Reading the candidate worktree would let a branch rewrite the obligation that judges that same branch.

A file reference also creates a serving problem. A reviewer should not need to leave a refusal, CI result, Proof, or variance decision to discover what the question asked. A repository path can control where prose is authored without becoming a deferred review dependency.

## Decision

**A checkpoint question file is governed repository content. Its path and bytes resolve from the same merge-base Git tree as the table that names it.**

- `question_file` is an explicit source. A project-authored checkpoint sets exactly one of `question` and `question_file`. A built-in inherits its shipped question when both are absent and may override it with exactly one. No filename inference exists.
- The path uses the canonical portable project-relative file validator and stays outside `.git`. The governing reader accepts only a regular Git blob, decodes UTF-8 fatally, retains authored line endings, and admits at most 65,536 bytes. It does not read a filesystem path or follow a symlink.
- Resolution produces one ordinary `ResolvedCheckpoint.question`. Downstream trigger, open-question, declaration, report, acceptance, and Proof code do not carry a second question type.
- The normalized source path and resolved content enter the definition hash. A candidate edit cannot change its own obligation. A governing path or content change received through `discern update` reopens the question. An unrelated merge-base move does not.
- Live config loading validates the current tracked file strictly. Historical file or source failures drop the affected checkpoint with typed evidence and do not suppress valid siblings.
- `reference` is presentation metadata for either source. It is never loaded or executed. Review surfaces show it separately and still include the complete resolved question.
- Repository privacy is the only privacy boundary. Resolved questions and references can appear in terminal output, MCP context, CI logs, Proof, and landing review, so neither may contain secrets.

## Consequences

- A project can keep a long question readable and versioned in Markdown without creating a branch-local self-exemption.
- Review remains self-contained even when authorship moves to a file.
- A source path, blob type, encoding, and byte limit become part of the live authoring contract. Historical violations remain visible as durable fail-open evidence.
- Files outside the repository, URLs as content, environment expansion, encrypted or vault-backed sources, submodules, and remote transports remain unsupported.

## Alternatives considered

- **Interpret a Markdown-looking `question` as a path.** Rejected because prose and filenames would share an ambiguous field.
- **Read the candidate worktree file.** Rejected because the branch could rewrite its own obligation, and filesystem symlinks would widen the authority boundary.
- **Render only “see file”.** Rejected because CI, Proof, MCP, and landing review would no longer carry the question being judged.
- **Load `reference` content.** Rejected because a pointer is useful without creating another content authority or transport contract.
