# ADR 0401: Managed adoption keeps currency and Proof separate

**Status**: accepted on 2026-09-15. Implements [ADR 0400](0400-release-records-drive-offline-release-awareness.md).

## Context

Setup completes through an owned marker commit and exact-tree validation. Upgrade reconciles managed artifacts in independent failure boundaries and retains successful effects when another artifact fails. Neither command can truthfully stamp adoption when it starts.

An older schema-capable engine can read the adoption key but cannot compare newer managed artifacts with its own templates. A passing project test stage does not establish that missing currency evidence.

## Decision

The optional `meta.managed_version` key joins schema 1 before publication. Publication inspection found no release tags or published GitHub releases. The production migration chain remains empty. The config ownership registry omits the key from the initial scaffold; successful completion supplies it.

The shared SemVer classifier owns absent, equal, running-newer, and project-managed-by-newer states. Release names have no role in precedence. Equal precedence preserves the original spelling, including build metadata.

Upgrade plans the previous and adopted values before applying effects. Its final config replacement commits schema and successful adoption atomically. A partial refresh retains its earlier effects and schema convergence, leaves adoption unchanged, and requires another upgrade to complete adoption.

Setup includes adoption in its owned completion marker, after materialization, and proves that exact commit. The existing rollback removes an owned failed marker. If wider Git state prevents that rollback, setup retracts only its unchanged adoption field and preserves other edits for recovery. Failed restoration remains an unresolved failure. Existing successful completion replay performs no new adoption; the upgrade command owns later adoption. Explicit unproven completion still requires successful materialization before it records adoption; adoption does not imply Gate Proof.

The operation-effect registry classifies managed-artifact writers. Public execution refuses older-binary writers and their previews before effects. The shared refresh and skill planners also guard internal callers. Status and doctor omit older-template comparisons and report their evidence boundary as advice. Prepare, update, refresh, upgrade, and setup cannot offer backward rewrite plans. Ordinary completion and landing refuse without currency evidence. Read-only operations and the configured test stage remain callable. Tests carry their own project-command permissions and do not issue ordinary completion Proof.

The Gate and landing boundary compare adoption with the governing trunk. Deleting the field or lowering its precedence is refused even in a clean revert. Restoring older managed bytes keeps the highest adopted value.

## Historical contract

The [first-public compatibility slice](../../../tests/fixtures/managed-version-baseline/README.md) freezes actual production reader, comparison, currency, and Gate-planning code with its template inputs. It is independent of the current parser and has no runtime source imports. It is not a published binary or the final install corpus. Lock-down 7A retains this optional-key contract in its final corpus; actual supported released engines become the historical test authority when they exist.

## Consequences

An older binary remains useful for observations and project tests while declining evidence it cannot establish. A newer development adoption may have no suitable public stable binary; release checking must establish that availability separately. The installer replaces executable bytes without discovering or adopting a project. Existing sessions retain their own compiled version until restarted.
