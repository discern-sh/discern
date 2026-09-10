/**
 * Named boundaries where a secondary side effect may fail without deciding the
 * primary operation's outcome.
 */

/** How one deliberate error-discard site is implemented. */
export type BestEffortBoundaryKind = "capability" | "direct";

/** Whether the protected side effect is synchronous or promise-shaped. */
export type BestEffortBoundaryShape = "sync" | "async";

/** What remains observable when the protected side effect fails. */
export type BestEffortObservability =
  | { readonly kind: "unobservable" }
  | {
    readonly kind: "reported";
    /** Existing product authority that receives the failure. */
    readonly authority: "Logger" | "Out" | "DiscernResult";
  };

/** One exact deliberate error-discard boundary. */
export interface BestEffortBoundary {
  /** Repository-relative module containing the live site. */
  readonly path: string;
  /** Stable function or method surrounding the live site. */
  readonly enclosingFunction: string;
  /** Concrete secondary operation whose failure does not decide the result. */
  readonly operation: string;
  /** Whether callers use the shared capability or an unavoidable syntax site. */
  readonly kind: BestEffortBoundaryKind;
  /** Synchronous catch or promise rejection handling. */
  readonly shape: BestEffortBoundaryShape;
  /** Where a discarded failure remains visible, if anywhere. */
  readonly observability: BestEffortObservability;
  /** Why this failure cannot replace or fail the primary operation. */
  readonly reason: string;
}

/** Preserve literal IDs while validating every registry value. */
function defineBestEffortBoundaries<
  const Boundaries extends Readonly<Record<string, BestEffortBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** The complete named set of deliberate production error-discard boundaries. */
export const BEST_EFFORT_BOUNDARIES = defineBestEffortBoundaries({
  "acceptance-transaction-temp-cleanup": {
    path: "src/engine/worktree/acceptance_transaction.ts",
    enclosingFunction: "writeAcceptanceTransaction",
    operation: "remove the unpublished transaction staging file",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The durable hard-link publication already decided the transaction outcome, and an inert same-directory temp cannot replace that primary result.",
  },
  "adr-duplicate-scan-fallback": {
    path: "src/lib/adr_numbers.ts",
    enclosingFunction: "duplicateAdrNumbers",
    operation:
      "return no duplicate ADR numbers when the record tree is unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Duplicate detection is an advisory enhancement for a record tree that may not exist yet, while ADR creation performs its own authoritative allocation checks.",
  },
  "agent-gitignore-template-fallback": {
    path: "src/lib/agent_gitignore.ts",
    enclosingFunction: "readGitignoreFragment",
    operation: "treat an unavailable bundled gitignore fragment as no source",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Callers preserve existing project content and surface either a fallback plan or blocking result when bundled ownership data is unavailable.",
  },
  "atomic-write-temp-cleanup": {
    path: "src/shared/atomic_write.ts",
    enclosingFunction: "removeAbandonedTemp",
    operation: "remove an abandoned atomic-replacement staging file",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The replacement failure remains authoritative and a never-published sibling temp cannot replace or obscure it.",
  },
  "await-branch-ref-fallback": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "evaluateCondition",
    operation: "evaluate a deleted watched branch from its last observed tip",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Landing deletes the branch by design, and the retained tip plus trunk reachability remains the authoritative transition evidence.",
  },
  "await-trunk-ref-fallback": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "evaluateCondition",
    operation: "treat a vanished trunk ref as a not-yet-met observation",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A ref deleted between observations cannot prove the requested trunk transition and therefore remains safely not met.",
  },
  "await-update-preview-fallback": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "updatePreview",
    operation: "omit advisory incoming-overlap preview facts",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The preview only decorates a satisfied wait; authoritative update rechecks every merge and overlap fact before acting.",
  },
  "await-watch-path-presence-fallback": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "existingPaths",
    operation: "omit one unreadable candidate from filesystem wake watching",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Filesystem events are only a wake optimization, while bounded authoritative polling still evaluates the wait condition.",
  },
  "await-watcher-close": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "waitForWakes",
    operation: "close the optional filesystem watcher at wait settlement",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The watcher may already have closed on its own failure path, and the polling result is already authoritative.",
  },
  "await-watcher-open-fallback": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "waitForWakes",
    operation: "continue a wait without an unavailable filesystem watcher",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The same bounded loop polls authoritative Git state, so filesystem watching is only a latency optimization.",
  },
  "await-watcher-pump-fallback": {
    path: "src/engine/await/await.ts",
    enclosingFunction: "waitForWakes",
    operation: "settle a failed filesystem event pump without failing the wait",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A watcher failure hands observation back to the bounded polling loop, which continues to own the condition verdict.",
  },
  "canon-editor-git-dirty-fallback": {
    path: "scripts/canon_editor/server.ts",
    enclosingFunction: "gitDirty",
    operation:
      "show no editor-owned dirty paths when the advisory Git query fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The editor status chip is advisory presentation and save operations still run their own Git-backed Proof before claiming success.",
  },
  "canon-editor-saved-note-fallback": {
    path: "scripts/canon_editor/ui/app.js",
    enclosingFunction: "showSavedNote",
    operation: "omit a malformed transient saved confirmation note",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The underlying save already completed and the session value controls only a short-lived confirmation chip on the next reload.",
  },
  "canon-editor-sse-controller-close": {
    path: "scripts/canon_editor/server.ts",
    enclosingFunction: "close",
    operation: "close one server-sent-event controller during editor shutdown",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "A client may already have closed its controller, while the editor must continue closing every remaining resource.",
  },
  "canon-editor-twin-storage-fallback": {
    path: "scripts/canon_editor/ui/app.js",
    enclosingFunction: "twinList",
    operation:
      "start with no queued twin reviews when browser storage is unavailable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Twin review state is local presentation metadata and unavailable or malformed storage cannot alter the canon content being edited.",
  },
  "canon-editor-watch-loop-settlement": {
    path: "scripts/canon_editor/server.ts",
    enclosingFunction: "close",
    operation: "settle the editor filesystem watch loop during shutdown",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Shutdown closes the watcher first, so a rejection from its terminating loop cannot prevent the server from closing.",
  },
  "checkpoint-economics-fallback": {
    path: "src/engine/checkpoints/report.ts",
    enclosingFunction: "observedCheckpointEconomics",
    operation:
      "omit advisory checkpoint economics when their history cannot load",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Economics only enrich the checkpoint report and the report's canonical configuration and obligation facts remain available without local history.",
  },
  "checkpoint-stored-config-parse-fallback": {
    path: "src/engine/checkpoints/policy.ts",
    enclosingFunction: "recoverHistoricalQuestionSources",
    operation: "decline recovery from malformed stored checkpoint TOML",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Recovery is restricted to structurally readable stored questions and the primary validator retains the actionable current config issues.",
  },
  "checkpoint-untracked-inspection-close": {
    path: "src/engine/checkpoints/diff.ts",
    enclosingFunction: "inspectUntracked",
    operation: "close a bounded untracked-file descriptor after inspection",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The retained inspection facts or structured unreadable result are already fixed and descriptor cleanup cannot replace either outcome.",
  },
  "checkpoint-untracked-nonregular-close": {
    path: "src/engine/checkpoints/diff.ts",
    enclosingFunction: "openUntrackedRegular",
    operation: "close a descriptor rejected as a non-regular untracked path",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The descriptor is already rejected and the caller retains an unknown file classification, so cleanup cannot make the path admissible.",
  },
  "checkpoint-untracked-open-fallback": {
    path: "src/engine/checkpoints/diff.ts",
    enclosingFunction: "openUntrackedRegular",
    operation:
      "classify an unopenable branch-controlled untracked path as unknown",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Checkpoint matching fails open for unknowable untracked bytes and never treats an open failure as positive path content evidence.",
  },
  "checkpoint-untracked-stat-error-close": {
    path: "src/engine/checkpoints/diff.ts",
    enclosingFunction: "openUntrackedRegular",
    operation: "close an untracked descriptor whose identity stat failed",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Failed descriptor identity makes the path inadmissible before any content read and cleanup cannot alter that fail-open verdict.",
  },
  "checkpoint-when-input-cleanup-outcome": {
    path: "src/engine/checkpoints/when.ts",
    enclosingFunction: "runWhenCommand",
    operation:
      "represent a temporary checkpoint-input cleanup failure in the trigger result",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The result fails the trigger open with a specific cleanup reason while preserving the command or input failure as the primary execution outcome.",
  },
  "compiled-lease-signal-registration": {
    path: "scripts/use_compiled_build.ts",
    enclosingFunction: "holdCompiledLease",
    operation:
      "register one optional platform signal for compiled-lease restoration",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Platforms may reject an unsupported signal while the remaining registered signals still own restoration.",
  },
  "config-command-list-parse-fallback": {
    path: "src/commands/config.ts",
    enclosingFunction: "serializedCommandList",
    operation: "treat a non-list TOML fragment as an ordinary scalar command",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Shell commands commonly are not TOML values, so parse rejection selects the documented scalar-command interpretation.",
  },
  "config-template-source-fallback": {
    path: "src/lib/config_template.ts",
    enclosingFunction: "readConfigTemplate",
    operation: "treat unavailable bundled config template text as no source",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Migration callers retain their explicit key-edit fallback and scaffold reconciliation blocks when it cannot prove the canonical source.",
  },
  "continuation-record-error-close": {
    path: "src/engine/continuations/store.ts",
    enclosingFunction: "createRecord",
    operation: "close a continuation file after its write or sync fails",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The original write failure must remain authoritative even when closing the partially written file also fails.",
  },
  "continuation-record-error-remove": {
    path: "src/engine/continuations/store.ts",
    enclosingFunction: "createRecord",
    operation: "remove a partial continuation record after its write fails",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The original write failure must survive cleanup, and retention later ignores any incomplete unreadable record.",
  },
  "continuation-record-final-close": {
    path: "src/engine/continuations/store.ts",
    enclosingFunction: "createRecord",
    operation: "close the continuation record at the end of one create attempt",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The handle or original write failure is already decided, and the error path may already have closed the file.",
  },
  "continuation-store-lock-fallback": {
    path: "src/engine/continuations/store.ts",
    enclosingFunction: "withStoreLock",
    operation:
      "decline continuation storage when its repository lock cannot be acquired",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Continuation creation and lookup already expose unavailable state to their callers, while running unlocked would corrupt the bounded shared store.",
  },
  "continuation-terminal-remove": {
    path: "src/engine/continuations/store.ts",
    enclosingFunction: "removeContinuation",
    operation: "remove a consumed terminal continuation record",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A missing, raced, or unreadable terminal record expires through the same bounded retention policy.",
  },
  "coupling-gate-hints-fallback": {
    path: "src/engine/coupling/coupling.ts",
    enclosingFunction: "couplingGateHints",
    operation:
      "omit advisory coupling hints when the diff survey cannot complete",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Hints cannot decide the gate and the coupling verb remains the explicit result surface for diagnosing an unavailable survey.",
  },
  "crash-error-field-fallback": {
    path: "src/engine/crash.ts",
    enclosingFunction: "errorField",
    operation: "omit one Error field whose hostile getter or proxy trap throws",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Crash reporting must remain total over arbitrary thrown values and substitutes bounded safe metadata for inaccessible fields.",
  },
  "crash-error-instanceof-fallback": {
    path: "src/engine/crash.ts",
    enclosingFunction: "isInspectableError",
    operation: "classify a hostile proxy as an uninspectable thrown value",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "A revoked proxy can throw from prototype inspection, and the crash reporter must still produce a bounded artifact without trusting it.",
  },
  "crash-git-artifact-fallback": {
    path: "src/engine/crash.ts",
    enclosingFunction: "writeCrashArtifact",
    operation:
      "fall back from repository crash storage to a temporary artifact",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Crash reporting is already secondary to the original failure, and the temporary store remains an independent recovery path.",
  },
  "crash-probe-env-fallback": {
    path: "src/engine/crash.ts",
    enclosingFunction: "throwIfCrashProbe",
    operation:
      "treat denied crash-probe environment access as no synthetic probe",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The probe is test-only opt-in behavior and denied environment access cannot constitute an affirmative request to crash.",
  },
  "crash-temp-artifact-unavailable": {
    path: "src/engine/crash.ts",
    enclosingFunction: "writeCrashArtifact",
    operation:
      "return no crash artifact when both report stores are unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The crash frame must retain the original application failure even when no secondary report destination can be written.",
  },
  "crash-thrown-value-text-fallback": {
    path: "src/engine/crash.ts",
    enclosingFunction: "thrownValueText",
    operation:
      "substitute bounded text when thrown-value coercion itself throws",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Crash reporting must be total over arbitrary hostile values and the fixed substitute reveals that inspection was unavailable.",
  },
  "crash-write-error-close": {
    path: "src/engine/crash.ts",
    enclosingFunction: "createCrashFile",
    operation: "close a crash report file after its write fails",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The original crash-report write failure must remain the cause seen by the fallback storage path.",
  },
  "crash-write-error-remove": {
    path: "src/engine/crash.ts",
    enclosingFunction: "createCrashFile",
    operation: "remove a partial crash report after its write fails",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A cleanup failure cannot replace the report write failure that selects the temporary storage fallback.",
  },
  "desk-project-scripts-fallback": {
    path: "src/engine/desk/desk.ts",
    enclosingFunction: "scripts",
    operation:
      "hide branch-local Project Scripts when their directory is unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A script cannot be offered safely without a successful inventory and the rest of the fleet survey remains authoritative.",
  },
  "desk-tip-presentation": {
    path: "src/engine/desk/desk.ts",
    enclosingFunction: "runDesk",
    operation: "read, select, and record one optional desk tip",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Tips are unsolicited presentation only and neither their state nor rendering may prevent the fleet desk from opening.",
  },
  "desk-tip-state-record": {
    path: "src/engine/desk/tip_state.ts",
    enclosingFunction: "writeTipSeenState",
    operation: "write the optional repository-shared desk tip seen-state",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A failed seen-state write only permits a tip to reappear sooner and cannot affect any desk action or repository state.",
  },
  "desk-worktree-config-fallback": {
    path: "src/engine/desk/desk.ts",
    enclosingFunction: "loadWorktreeConfig",
    operation:
      "hide provider launch actions for a worktree with unreadable config",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Launch availability cannot fall back to another checkout's provider set, while Git-backed fleet facts remain visible.",
  },
  "diagnostic-full-output-record": {
    path: "src/engine/gate/diagnostic_output.ts",
    enclosingFunction: "writeFullOutput",
    operation:
      "offload uncapped diagnostic output to an owned temporary artifact",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The capped diagnostic remains complete enough to act on and an artifact failure cannot replace the underlying gate diagnostic.",
  },
  "dispatch-command-suggestion-config-fallback": {
    path: "src/engine/dispatch.ts",
    enclosingFunction: "reportUnknownOrSuggest",
    operation: "omit project-script suggestions when config cannot load",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Unknown-command reporting remains complete without project-local suggestions and never executes a script from this path.",
  },
  "docs-leaf-metadata-fallback": {
    path: "src/lib/docs.ts",
    enclosingFunction: "discoverDocs",
    operation:
      "retain humanized metadata for an unreadable or malformed documentation leaf",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Discovery keeps the leaf addressable from directory structure while strict fetch and integrity surfaces report failures when content is required.",
  },
  "docs-pager-input-close": {
    path: "src/lib/pager.ts",
    enclosingFunction: "pageThrough",
    operation: "finish writing rendered content to the external pager",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A user who quits the pager may close its input early; the child status still decides whether presentation succeeded.",
  },
  "doctor-model-config-fallback": {
    path: "src/commands/doctor.ts",
    enclosingFunction: "loadModelConfig",
    operation:
      "omit the execution model when the project config cannot be loaded",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Doctor's ordinary checks report the actionable config failure, while a default-derived execution model would add misleading noise.",
  },
  "effort-grant-restore-outcome": {
    path: "src/engine/worktree/effort_grant_cleanup.ts",
    enclosingFunction: "restoreEffortGrantClaim",
    operation:
      "represent an unavailable grant restoration as an unsettled result",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The caller preserves the primary Git outcome and receives false so recovery evidence remains unsettled instead of throwing a secondary filesystem failure.",
  },
  "first-party-license-payload-compare-fallback": {
    path: "src/shared/first_party_license_codegen.ts",
    enclosingFunction: "sameFirstPartyLicenseBundlePayload",
    operation: "report malformed generated license modules as unequal",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Malformed generated content must force regeneration and can never be treated as matching the canonical license bundle.",
  },
  "gate-active-standard-proposals-fallback": {
    path: "src/engine/gate/finish.ts",
    enclosingFunction: "activeStandardLimitProposalState",
    operation:
      "omit advisory active standard proposal decoration when inspection fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Proposal decoration cannot decide the gate and later proposal application revalidates its own exact authority and evidence.",
  },
  "gate-live-output-flush": {
    path: "src/engine/gate/execute.ts",
    enclosingFunction: "flush",
    operation:
      "deliver buffered human-mode gate output to its presentation sink",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Captured job results remain authoritative and the false return preserves presentation failure without changing the scheduler verdict.",
  },
  "gate-tty-observer-close": {
    path: "src/engine/gate/gate_tty.ts",
    enclosingFunction: "close",
    operation: "close the optional live terminal viewport observer",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Terminal presentation cleanup cannot alter the completed gate result or leave an async failure behind.",
  },
  "gate-tty-observer-open-fallback": {
    path: "src/engine/gate/gate_tty.ts",
    enclosingFunction: "liveViewport",
    operation:
      "retain the initial terminal size when live viewport observation is unavailable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Viewport observation is presentation-only, and the stable invocation snapshot remains a complete fallback.",
  },
  "gate-tty-observer-sample-fallback": {
    path: "src/engine/gate/gate_tty.ts",
    enclosingFunction: "size",
    operation:
      "retain the last terminal size when a live viewport sample fails",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "A presentation probe cannot decide the gate result, and the last valid viewport remains safe for rendering.",
  },
  "gate-tty-write-outcome": {
    path: "src/engine/gate/gate_tty.ts",
    enclosingFunction: "safeWrite",
    operation: "record a failed transient gate terminal presentation write",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The progress adapter exposes the failed-write flag to gate while job results and the final result envelope remain authoritative.",
  },
  "git-orphan-identity-fallback": {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "inspectOrphanWorktree",
    operation: "treat an unreadable orphan identity as unowned",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Ownership failure keeps the orphan checkout rather than authorizing deletion, so omitting the identity fails safely.",
  },
  "git-prune-record-identity-fallback": {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "scanGitWorktreesForPrune",
    operation: "treat an invalid prunable metadata identity as unowned",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "An unavailable identity removes the record from automatic cleanup eligibility and therefore preserves the checkout and branch.",
  },
  "git-stale-metadata-identity-fallback": {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "pruneStaleWorktreeMetadata",
    operation: "treat an invalid live metadata identity as unowned",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The final pre-delete ownership recheck fails closed when the identity cannot be derived, retaining all metadata.",
  },
  "identity-config-read-fallback": {
    path: "src/engine/worktree/identity.ts",
    enclosingFunction: "loadIdentitySettings",
    operation:
      "derive identity defaults while project configuration is unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Worktree naming must remain available while configuration is missing or mid-edit, and required identity fields are validated after defaults and environment overrides apply.",
  },
  "ignored-baseline-decode-fallback": {
    path: "src/engine/worktree/ignored.ts",
    enclosingFunction: "readBaseline",
    operation: "treat malformed ignored-root baseline JSON as unavailable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The versioned schema remains the authority and malformed advisory baseline data disables comparison instead of becoming trusted state.",
  },
  "ignored-baseline-record": {
    path: "src/engine/worktree/ignored.ts",
    enclosingFunction: "recordIgnoredFileBaseline",
    operation: "record the advisory ignored-file baseline after setup",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A missing baseline merely disables a later drift warning and cannot turn successful worktree setup into failure.",
  },
  "ignored-symlink-target-fallback": {
    path: "src/engine/worktree/ignored.ts",
    enclosingFunction: "fingerprintRoot",
    operation: "fingerprint an unreadable ignored symlink target as unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The stable unreadable sentinel preserves drift detection without claiming a target value or failing worktree setup over advisory ignored-file evidence.",
  },
  "improve-checkpoint-observations-fallback": {
    path: "src/engine/improve/rules.ts",
    enclosingFunction: "variedCheckpointEvidence",
    operation:
      "omit advisory frequently varied checkpoint evidence when history cannot load",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Improvement retains every configuration-derived rule and treats unavailable local history as no earned recommendation rather than inventing evidence.",
  },
  "job-output-observer-notify": {
    path: "src/engine/jobs/command.ts",
    enclosingFunction: "emit",
    operation: "notify the optional live job-output presentation observer",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Presentation is downstream of captured child bytes and cannot change the job verdict or retained output.",
  },
  "job-output-reader-cancel": {
    path: "src/engine/jobs/command.ts",
    enclosingFunction: "onAbort",
    operation:
      "cancel one child-output reader after the killed-pipe grace period",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The read is already closed or being abandoned after process cancellation, and settlement must not create a detached rejection.",
  },
  "job-output-record-create-fallback": {
    path: "src/engine/jobs/output_record.ts",
    enclosingFunction: "create",
    operation:
      "continue without a full-output artifact when its file cannot be created",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The in-memory line and diagnostic summary remains authoritative when the advisory full-output artifact is unavailable.",
  },
  "job-output-record-error-close": {
    path: "src/engine/jobs/output_record.ts",
    enclosingFunction: "write",
    operation: "close the full-output artifact after one write fails",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The recorder already drops the advisory path after a write failure, so close cannot change the job result.",
  },
  "job-output-record-finish-close": {
    path: "src/engine/jobs/output_record.ts",
    enclosingFunction: "finish",
    operation: "drop the advisory output path when closing its artifact fails",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The job summary remains complete without an output path, while publishing a file that did not close cleanly would be misleading.",
  },
  "job-spawn-observer-notify": {
    path: "src/engine/jobs/command.ts",
    enclosingFunction: "spawnJob",
    operation:
      "notify the advisory observer after a native command has spawned, with its capture location",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Accounting and the transcript pointer are downstream of native process creation and cannot interrupt child supervision or decide a validation verdict.",
  },
  "lifecycle-drop-identity-settings-fallback": {
    path: "src/engine/worktree/removal_plan.ts",
    enclosingFunction: "buildRemovalPlan",
    operation:
      "continue exact path matching without unavailable identity settings",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Drop can still match canonical paths and basenames, while identity matching is omitted instead of guessing from invalid configuration.",
  },
  "lifecycle-live-port-identity-fallback": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "livePortsInUse",
    operation:
      "omit an unreadable sibling identity from advisory port collision data",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Port uniqueness is explicitly best effort and worktree creation still verifies branch and directory identity before mutation.",
  },
  "lifecycle-ready-sentinel-write": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "worktreeSetup",
    operation: "write the advisory worktree-ready ownership sentinel",
    kind: "capability",
    shape: "async",
    observability: { kind: "reported", authority: "Logger" },
    reason:
      "The setup and refresh results already decide worktree creation, while a missing sentinel only disables later automatic cleanup eligibility.",
  },
  "lifecycle-refresh-adr-target-fallback": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "updateRefreshCompiledPaths",
    operation:
      "omit an unavailable generated ADR index target from conflict policy",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Unknown generated ownership fails closed and the later refresh step reports the authoritative compilation failure.",
  },
  "lifecycle-refresh-agent-targets-fallback": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "updateRefreshCompiledPaths",
    operation: "omit unavailable generated agent targets from conflict policy",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Unknown generated ownership fails closed and the later refresh step reports the authoritative compilation failure.",
  },
  "lifecycle-resource-identity-settings-fallback": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "liveResourceIdentitySet",
    operation:
      "omit the advisory identity liveness set when settings are unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Independent Git-key and path liveness checks remain mandatory before destruction, so losing this third guard cannot authorize cleanup alone.",
  },
  "lifecycle-resource-row-identity-fallback": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "liveResourceIdentitySet",
    operation:
      "omit one unresolved worktree from advisory resource identity liveness",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Independent Git-key and path liveness checks remain mandatory before destruction, so this optional identity guard cannot authorize cleanup alone.",
  },
  "lifecycle-source-manifest-decode-fallback": {
    path: "src/engine/worktree/lifecycle.ts",
    enclosingFunction: "discernSourceEntrypoint",
    operation: "decline local source execution for malformed Deno project JSON",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Only a validated discern development manifest may authorize source execution; malformed unrelated project metadata proves no capability.",
  },
  "logbook-agent-host-marker-fallback": {
    path: "src/engine/logbook/agent_signals.ts",
    enclosingFunction: "detectAgentSignals",
    operation: "omit one unreadable coding-agent host marker",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Host markers are advisory identity evidence, so an unreadable candidate proves no signal and cannot affect the invoked verb.",
  },
  "logbook-begin-append": {
    path: "src/engine/logbook/record.ts",
    enclosingFunction: "beginRecording",
    operation: "append one advisory logbook begin event",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Local recording is downstream of the verb and can neither delay nor fail the operation it observes.",
  },
  "logbook-cli-agent-signals-fallback": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "cliDriverFacts",
    operation: "omit unavailable advisory coding-agent identity signals",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Driver enrichment is metadata-only and must not change the CLI verb whose invocation it describes.",
  },
  "logbook-cli-ci-fallback": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "cliDriverFacts",
    operation: "record no CI signal when process environment access is denied",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The CI marker is advisory driver metadata, and missing permission is not affirmative CI evidence.",
  },
  "logbook-cli-spawned-by-fallback": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "cliDriverFacts",
    operation:
      "omit the spawned-by driver marker when environment access is denied",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The marker is optional attribution metadata and cannot affect the verb or imply an identity when unreadable.",
  },
  "logbook-cli-tty-fallback": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "cliDriverFacts",
    operation: "record closed or unreadable standard output as non-terminal",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Terminal attachment is advisory driver metadata, and an unavailable output handle cannot support a positive terminal claim.",
  },
  "logbook-epoch-state-decode-fallback": {
    path: "src/engine/logbook/store.ts",
    enclosingFunction: "inspectEpochState",
    operation: "treat malformed advisory logbook epoch JSON as unavailable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Epoch reuse is optional and schema validation still rejects foreign shapes, so malformed local cache data starts a fresh epoch comparison.",
  },
  "logbook-finish-append": {
    path: "src/engine/logbook/record.ts",
    enclosingFunction: "finish",
    operation: "append advisory logbook completion and standard pin events",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The verb's result is already fixed, so local history recording cannot alter, delay, or reject that result.",
  },
  "logbook-month-read-outcome": {
    path: "src/engine/logbook/read.ts",
    enclosingFunction: "readLogbookStream",
    operation: "count one unreadable logbook month as an unparsed unit",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The stream result preserves every readable event and explicitly increments its unparsed count rather than claiming the month was empty.",
  },
  "logbook-recent-month-read-outcome": {
    path: "src/engine/logbook/read.ts",
    enclosingFunction: "readRecentLogbookStream",
    operation: "count one unreadable recent logbook month as an unparsed unit",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The bounded recent stream preserves every readable event and explicitly increments its unparsed count rather than claiming the month was empty.",
  },
  "logbook-recording-config-fallback": {
    path: "src/engine/logbook/record.ts",
    enclosingFunction: "gatherContext",
    operation:
      "disable logbook recording when consent configuration is unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Unreadable consent state must conservatively disable optional recording rather than infer permission.",
  },
  "logbook-recording-context-fallback": {
    path: "src/engine/logbook/record.ts",
    enclosingFunction: "beginRecording",
    operation:
      "treat failed advisory invocation-context gathering as unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Context gathering only enriches local history and can never become a failure path for the observed verb.",
  },
  "logbook-snapshot-temp-remove": {
    path: "src/engine/logbook/store.ts",
    enclosingFunction: "archiveLogbook",
    operation:
      "remove a partial temporary logbook archive after publication fails",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The detached source snapshot remains the recovery authority and cleanup must never replace the primary archive failure reported to the caller.",
  },
  "logbook-validation-elapsed-fallback": {
    path: "src/engine/logbook/validation_state.ts",
    enclosingFunction: "safeElapsed",
    operation:
      "fall back to zero diagnostic elapsed time after a clock failure",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Elapsed time only decorates a fail-open capture result and zero avoids introducing a second failure while the validation finding remains authoritative.",
  },
  "main-crash-cwd-fallback": {
    path: "src/main.ts",
    enclosingFunction: "exitWithCrashFrame",
    operation: "fall back to the process temp directory after cwd deletion",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Crash reporting must survive a deleted working directory, and the artifact writer retains the original crash as its authoritative cause.",
  },
  "map-link-uri-decode-fallback": {
    path: "src/lib/map_integrity.ts",
    enclosingFunction: "resolveTarget",
    operation: "classify a malformed percent-encoded map link as unresolvable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The integrity diagnostic reports the invalid target through its ordinary unresolved-link result instead of exposing URI decoder mechanics.",
  },
  "mcp-agent-signals-fallback": {
    path: "src/engine/mcp/server.ts",
    enclosingFunction: "mcpDriverFacts",
    operation: "omit unavailable advisory coding-agent identity signals",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Driver enrichment is metadata-only and must not alter the MCP tool result it describes.",
  },
  "mcp-ci-marker-fallback": {
    path: "src/engine/mcp/server.ts",
    enclosingFunction: "mcpDriverFacts",
    operation: "record no CI signal when process environment access is denied",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The CI marker is advisory session metadata, and denied access cannot support a positive CI claim.",
  },
  "mcp-setup-gate-config-fallback": {
    path: "src/engine/mcp/server.ts",
    enclosingFunction: "setupGatePasses",
    operation: "leave setup tools reachable while project config is unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Setup tools are the repair path for a broken config and their own cores retain the actionable parse failure.",
  },
  "mcp-version-command-path-fallback": {
    path: "src/engine/mcp/version_check.ts",
    enclosingFunction: "resolveCommandPath",
    operation: "omit an unavailable PATH-resolved discern executable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The running executable remains observable, while an unavailable provider command cannot support an installed-version claim and must not block MCP startup.",
  },
  "mcp-version-probe-fallback": {
    path: "src/engine/mcp/version_check.ts",
    enclosingFunction: "defaultProbeVersion",
    operation:
      "omit the advisory installed-discern version when its probe cannot run",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Version checking must never invent a restart warning and MCP tool dispatch remains authoritative when the optional executable probe is unavailable.",
  },
  "mcp-version-stat-fallback": {
    path: "src/engine/mcp/version_check.ts",
    enclosingFunction: "defaultStatKey",
    operation:
      "omit the advisory installed-discern version hint when stat fails",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The hint must never invent an upgrade warning when the executable identity cannot be observed, and tool dispatch remains authoritative.",
  },
  "operation-journal-result-retain": {
    path: "src/engine/completion/operation_journal.ts",
    enclosingFunction: "finish",
    operation:
      "keep the reduced result account when the complete-envelope sibling cannot be written",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The bounded record still names the operation and its verdict; a reader missing the complete envelope re-reads the command's own surfaces instead of the journal failing its operation.",
  },
  "operation-journal-write-fallback": {
    path: "src/engine/completion/operation_journal.ts",
    enclosingFunction: "persist",
    operation: "stop journal updates after one durable replace fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A journal that cannot persist stops updating rather than failing the operation; the stale record still names the operation and its start.",
  },
  "operation-lock-acquire-rollback": {
    path: "src/engine/operation_lock.ts",
    enclosingFunction: "acquireLock",
    operation: "restore inert lock-record bytes after lease publication fails",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The refusal closes the operating-system lock authority and rollback failure cannot replace the primary actionable acquisition error.",
  },
  "operation-lock-delegation-decode-fallback": {
    path: "src/shared/operation_lock_context.ts",
    enclosingFunction: "inheritedOperationLockLease",
    operation: "reject malformed inherited operation-lock delegation state",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Untrusted environment data grants no lock authority unless it decodes and validates completely.",
  },
  "operation-lock-record-restore": {
    path: "src/engine/operation_lock.ts",
    enclosingFunction: "releaseLocks",
    operation: "restore inert lock-record bytes before closing a released lock",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The operating-system handle is the sole ownership authority and stale record bytes become inert as soon as that handle closes.",
  },
  "owned-child-direct-signal": {
    path: "src/engine/owned_child.ts",
    enclosingFunction: "signalDirectChild",
    operation: "signal a directly owned child that may already have exited",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Process settlement remains authoritative and a raced child exit is already the desired cancellation state.",
  },
  "private-docs-git-query-fallback": {
    path: "scripts/ensure_private_docs.ts",
    enclosingFunction: "gitQuery",
    operation:
      "skip private-doc generation when its Git location query cannot run",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The generator is a checkout-local convenience and deliberately exits without writing when it cannot establish the repository and common directories.",
  },
  "process-group-signal-outcome": {
    path: "src/shared/process_group.ts",
    enclosingFunction: "signalProcessGroup",
    operation: "represent an unavailable process-group signal as false",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Callers already treat false as the exact no-signal outcome and preserve the command result while continuing bounded cleanup.",
  },
  "process-self-signal": {
    path: "src/engine/process_signals.ts",
    enclosingFunction: "reraiseInterrupt",
    operation: "re-raise an interrupt signal in the supervising process",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Unsupported self-signalling retains the conventional signal exit-code fallback and cannot prevent process termination.",
  },
  "process-tree-direct-signal": {
    path: "src/engine/process_signals.ts",
    enclosingFunction: "killProcessTree",
    operation: "signal a direct process whose group could not be signalled",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The process may already have exited and owned-child settlement plus later escalation remain responsible for termination.",
  },
  "proof-fresh-standard-evidence-decode-fallback": {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "parseFreshStandardMeasurementEvidence",
    operation: "reject malformed or foreign fresh standard proposal evidence",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Proposal authority requires schema-validated exact-HEAD evidence, so invalid persisted input cannot authorize a transaction.",
  },
  "proof-fresh-standard-evidence-record": {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "recordFreshStandardMeasurementEvidence",
    operation: "write optional fresh standard proposal evidence",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Proposal evidence is optional transaction input; a failed write leaves ordinary standard enforcement in force and reports no success.",
  },
  "proof-last-gate-run-record": {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "recordLastGateRun",
    operation: "replace or remove the optional last-Gate-run marker",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The marker only enables a rerun shortcut; its absence leaves the normal gate precondition path authoritative.",
  },
  "proof-render-diff-fallback": {
    path: "src/engine/gate/proof_render.ts",
    enclosingFunction: "buildGateProof",
    operation:
      "decline Proof construction when changed-file facts cannot be measured",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A gate Proof is emitted only from complete measured facts, and the caller retains the ordinary non-reusable gate result when evidence is unavailable.",
  },
  "proof-standard-measurements-clear": {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "clearStandardMeasurements",
    operation: "remove cached standard measurements after a failed check",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A later replay validates exact clean-HEAD evidence and fails closed, so this cleanup cannot alter the current result.",
  },
  "proof-standard-measurements-record": {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "recordStandardMeasurements",
    operation: "write optional clean-HEAD standard measurement replay data",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The replay record is a cache only; failing to write it cannot invalidate the completed gate and the false return retains that outcome.",
  },
  "providers-toml-decode-fallback": {
    path: "src/lib/providers.ts",
    enclosingFunction: "parseTomlObject",
    operation: "treat malformed optional provider TOML as empty settings",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Provider registration owns only its exact keys and rebuilds them from canonical configuration without trusting malformed optional settings.",
  },
  "resource-ledger-decode-fallback": {
    path: "src/engine/worktree/resources.ts",
    enclosingFunction: "parseResourceEntry",
    operation: "treat malformed worktree resource ledger JSON as unavailable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Garbage collection accepts only schema-validated ownership evidence, so malformed local state cannot authorize resource destruction.",
  },
  "resource-ledger-entry-remove": {
    path: "src/engine/worktree/resources.ts",
    enclosingFunction: "removeEntryFile",
    operation: "remove an already-settled resource ledger entry",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Resource creation or destruction already determined the primary outcome, and a retained advisory record is safer than replacing that result.",
  },
  "retired-path-excess-record-remove": {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "pruneStore",
    operation: "remove a retired-path record beyond the bounded retention cap",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Retention pruning is advisory housekeeping after the authoritative path removal, and a later mutation retries the same bounded sweep.",
  },
  "retired-path-expired-record-remove": {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "pruneStore",
    operation: "remove an expired retired-path evidence record",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Retention pruning is advisory housekeeping after the authoritative path removal, and a later mutation retries the same bounded sweep.",
  },
  "retired-path-inspection-read-outcome": {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "inspectPath",
    operation:
      "block cleanup when reappeared path contents cannot be inspected",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The structured cleanup-blocked reason fails deletion closed and retains the path whenever its contents cannot be proven safe.",
  },
  "retired-path-record-decode-fallback": {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "parseRecord",
    operation: "reject malformed retired-worktree evidence JSON",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Recovery accepts only bounded versioned records, and malformed evidence cannot authorize inspection or deletion of an old path.",
  },
  "retired-path-stale-temp-remove": {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "pruneStore",
    operation: "remove a stale retired-path store staging file",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Staging cleanup is advisory housekeeping and a retained temp neither becomes a live record nor authorizes filesystem deletion.",
  },
  "retired-path-store-operation-fallback": {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "withStoreLock",
    operation: "return an unavailable advisory retired-path store operation",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The store records completed path removals only; inability to update advisory evidence cannot roll back the authoritative filesystem result.",
  },
  "self-shim-admin-store-fallback": {
    path: "src/shared/self_shim.ts",
    enclosingFunction: "selfShimDir",
    operation:
      "fall back to a process temp shim when Git-admin storage is unusable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Operator commands still receive an identity-pinned shim in the registered temp-artifact family, so an unusable repository cache cannot block a spawn.",
  },
  "self-shim-aside-cleanup": {
    path: "src/shared/self_shim.ts",
    enclosingFunction: "writeShimAside",
    operation: "remove a losing self-shim staging file after a rename race",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The original rename outcome remains authoritative and the content check independently decides whether the concurrent publication is valid.",
  },
  "self-shim-keepalive-touch": {
    path: "src/shared/self_shim.ts",
    enclosingFunction: "touch",
    operation: "refresh a reusable self-shim directory timestamp",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Timestamp refresh is reaper hygiene only and cannot prevent the already-validated shim from being used for a child spawn.",
  },
  "settings-template-decode-fallback": {
    path: "src/lib/settings_strip.ts",
    enclosingFunction: "stripTemplateContribution",
    operation:
      "skip contribution removal from a malformed historical settings template",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Only structurally valid seed content can prove ownership, while independent hook detection still removes discern-owned hook groups.",
  },
  "setup-agent-file-ownership-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "seedInstructions",
    operation: "proceed without prior generated-agent ownership patterns",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "An unavailable fresh config cannot prove generated ownership, so setup conservatively preserves and migrates existing agent files.",
  },
  "setup-brief-render-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "runSetupBegin",
    operation:
      "serve the complete rendered setup brief when page parsing fails",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The unpaged brief remains complete instructions, while the suite separately validates the shipped page spine.",
  },
  "setup-configured-agents-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "resolveScaffoldInput",
    operation:
      "leave agent selection unset when an existing config is unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The established repair flow selects defaults and doctor reports the persisted config failure separately.",
  },
  "setup-existing-bootstrap-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "runSetupBegin",
    operation: "treat an unreadable existing config as not yet bootstrapped",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Setup must remain available to repair a broken configuration instead of falsely declaring the project complete.",
  },
  "setup-machinery-evidence-clear": {
    path: "src/commands/setup.ts",
    enclosingFunction: "commitProvenMachinery",
    operation:
      "clear one-time setup machinery commit evidence after a durable commit",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The committed HEAD and index Proof cannot authorize a second commit even if deleting the advisory evidence fails.",
  },
  "setup-machinery-evidence-decode-fallback": {
    path: "src/shared/setup_machinery_evidence.ts",
    enclosingFunction: "parseEvidence",
    operation: "reject malformed persisted setup retry evidence",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Only fully decoded and validated evidence can authorize retry behavior, so malformed state is equivalent to no trusted evidence.",
  },
  "setup-project-metadata-decode-fallback": {
    path: "src/shared/setup_messages.ts",
    enclosingFunction: "deriveProjectNameRecommendation",
    operation:
      "omit malformed project metadata from setup name recommendations",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Project metadata is one optional recommendation source and its own toolchain remains responsible for reporting invalid JSON.",
  },
  "setup-required-effects-config-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "beginRequiredEffects",
    operation:
      "plan conservative setup effects when persisted config loading fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The effect plan must over-approximate all registered providers and default paths when persisted choices are unavailable.",
  },
  "setup-scaffold-instruction-path-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "scaffoldHarness",
    operation:
      "seed instructions at the registry default when fresh config loading fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The default seed preserves setup progress, while doctor remains the authority that diagnoses the written config.",
  },
  "setup-skeleton-config-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "runSetupBegin",
    operation:
      "lay setup skeletons from scaffold facts when persisted config loading fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A resumed partial setup must still lay its skeletons, and fresh scaffold facts or registry defaults remain available.",
  },
  "setup-skeleton-marker-config-fallback": {
    path: "src/shared/setup_state.ts",
    enclosingFunction: "findSkeletonMarkers",
    operation:
      "inspect default skeleton paths while project configuration is unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Configuration diagnostics remain authoritative and the marker scan safely narrows to the shipped default tree instead of guessing custom paths.",
  },
  "setup-step-paths-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "runSetupStep",
    operation: "render a setup step with registry-default authored paths",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Strict verbs diagnose a broken config; the read-only brief remains useful with its discoverable default paths.",
  },
  "setup-uncommitted-footprint-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "uncommittedSetupWork",
    operation: "classify authored setup work with registry-default paths",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "A broken config is rejected by the Proof, while default authored paths keep the preliminary cleanliness account conservative.",
  },
  "setup-unmet-checks-config-fallback": {
    path: "src/commands/setup.ts",
    enclosingFunction: "unmetSetupChecks",
    operation: "defer setup completion checks when their config cannot load",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The finish Proof reports the config failure itself, so derived step checks must not restate it as incomplete work.",
  },
  "setup-verify-config-fallback": {
    path: "src/commands/setup_verify.ts",
    enclosingFunction: "runSetupVerify",
    operation: "classify an unparseable project config as setup in progress",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The read-only preflight redirects to strict setup verbs, which retain and report the actual config failure.",
  },
  "setup-welcome-config-fallback": {
    path: "src/commands/setup_welcome.ts",
    enclosingFunction: "runSetupWelcome",
    operation:
      "keep the welcome available while an existing config is unparseable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The welcome only selects an instruction source; strict commands remain responsible for reporting and repairing the config error.",
  },
  "site-docs-scroll-read-fallback": {
    path: "site/pages/assets/docs.js",
    enclosingFunction: "<module>",
    operation:
      "start documentation navigation without a stored scroll position",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Session storage is optional browser state and the current navigation item is revealed from the live document when persistence is unavailable.",
  },
  "site-docs-scroll-write-fallback": {
    path: "site/pages/assets/docs.js",
    enclosingFunction: "persistNavScroll",
    operation:
      "continue documentation navigation when scroll persistence fails",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The write only restores presentation position on a later page and cannot affect the current navigation or content.",
  },
  "site-docs-search-load-fallback": {
    path: "site/pages/assets/docs.js",
    enclosingFunction: "load",
    operation:
      "show an empty failed state when the documentation search index cannot load",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The browser state explicitly records the load error and renders no search results instead of claiming the index loaded successfully.",
  },
  "site-preview-probe-fallback": {
    path: "site/dev.ts",
    enclosingFunction: "discoverManagedSitePreview",
    operation: "classify an unreachable preview control endpoint as absent",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The probe is ownership discovery before planning; replacement still verifies recorded process identity and never trusts an unreachable server.",
  },
  "site-theme-read-fallback": {
    path: "site/pages/assets/theme.js",
    enclosingFunction: "storedTheme",
    operation:
      "fall back to the live system theme when browser storage is unavailable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Theme persistence is optional presentation state and the operating-system preference remains a complete current-page fallback.",
  },
  "site-theme-write-fallback": {
    path: "site/pages/assets/theme.js",
    enclosingFunction: "override",
    operation:
      "apply a theme change without persisting it when browser storage fails",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The current page still applies the requested theme and only cross-page persistence is lost when optional storage is disabled.",
  },
  "skills-ejected-tree-chmod": {
    path: "src/lib/skills.ts",
    enclosingFunction: "chmodWritable",
    operation: "make one freshly copied ejected skill tree writable",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Ejection has already copied the complete skill, and host defaults usually leave it readable even when permission normalization fails.",
  },
  "skills-materialized-manifest-decode-fallback": {
    path: "src/lib/skills.ts",
    enclosingFunction: "readMaterializedNames",
    operation:
      "disable orphan pruning for malformed materialized-skill ownership JSON",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Pruning requires positive ownership evidence, so a malformed local manifest cannot authorize deletion of any skill directory.",
  },
  "standard-proposal-store-decode-fallback": {
    path: "src/engine/gate/standard_proposal_state.ts",
    enclosingFunction: "parseProposalStore",
    operation: "reject malformed standard limit proposal authority state",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Standard changes fail closed unless the one versioned proposal authority validates completely, so malformed state authorizes nothing.",
  },
  "standard-proposal-transaction-decode-fallback": {
    path: "src/engine/gate/standard_proposals.ts",
    enclosingFunction: "parseProposalTransaction",
    operation: "reject a malformed standard proposal recovery journal",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Recovery applies only a schema-validated exact transaction and malformed journal data cannot authorize any config or evidence write.",
  },
  "status-identity-settings-fallback": {
    path: "src/engine/status/status.ts",
    enclosingFunction: "statusResult",
    operation:
      "omit derived fleet identities when identity settings cannot load",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Fleet rows still report Git facts, while unavailable identity settings cannot safely derive worktree IDs or ports.",
  },
  "status-root-canonicalization-fallback": {
    path: "src/engine/status/status.ts",
    enclosingFunction: "statusResult",
    operation:
      "compare the lexical invocation root when canonicalization fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Fleet current-row decoration is advisory and the already resolved lexical project root remains a deterministic fallback.",
  },
  "status-worktree-id-fallback": {
    path: "src/engine/status/status.ts",
    enclosingFunction: "fleetEntryFor",
    operation:
      "omit a derived worktree identity when metadata resolution fails",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The fleet row retains its Git state and path, while unresolved metadata cannot safely invent an ID or port.",
  },
  "subprocess-bounded-child-kill": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "terminate",
    operation: "kill a bounded child whose process group is already gone",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The timeout or output limit already decides termination, and the child may exit between the group probe and direct signal.",
  },
  "subprocess-command-probe-fallback": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "commandExists",
    operation: "report a failed command-existence probe as unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The probe is advisory and false is the explicit no-runnable-command outcome consumed by diagnostics and setup checks.",
  },
  "subprocess-input-abort": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "writeChildInput",
    operation: "abort a child input writer after its primary write failure",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The original input error is returned to the caller and writer abort cleanup cannot replace its more specific cause.",
  },
  "subprocess-output-reader-cancel": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "cancel",
    operation: "cancel a bounded child output reader after capture abort",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The timeout or byte ceiling already decides capture termination and the reader may already be closed or errored.",
  },
  "subprocess-stdin-abort": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "runGit",
    operation: "abort a Git child input writer after a write failure",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The original input error remains available and the child process result stays authoritative when it reports a more specific failure.",
  },
  "subprocess-timeout-child-kill": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "runGit",
    operation: "kill a Git child after the caller-owned timeout wins",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The timeout already fixes the command result and the child may exit at the same instant the timer settles.",
  },
  "temp-artifact-stale-remove": {
    path: "src/shared/temp_artifacts.ts",
    enclosingFunction: "pruneStaleTempArtifacts",
    operation: "remove one stale owned temporary artifact",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Artifact retention is bounded housekeeping and a raced or unreadable entry cannot decide the gate or verb that triggered the sweep.",
  },
  "terminal-background-sense-fallback": {
    path: "src/lib/terminal.ts",
    enclosingFunction: "createProductionTerminalContextResolver",
    operation:
      "fall back to the dark terminal theme when background sensing rejects",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Background sensing controls presentation only and the stable dark theme preserves command behavior when the terminal does not answer.",
  },
  "terminal-environment-read-fallback": {
    path: "src/lib/terminal.ts",
    enclosingFunction: "environmentSnapshot",
    operation: "treat one sandbox-denied terminal variable as unset",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Terminal presentation degrades through documented defaults, while no command semantics depend on optional display environment facts.",
  },
  "terminal-interaction-frame-newline": {
    path: "src/lib/terminal_interaction.ts",
    enclosingFunction: "terminateUnexpectedFrame",
    operation:
      "write a semantic newline after an unexpected interaction failure",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The original interaction failure remains authoritative and terminal frame completion is presentation-only cleanup.",
  },
  "terminal-interaction-trace-target-fallback": {
    path: "src/lib/terminal_interaction.ts",
    enclosingFunction: "interactionTraceTarget",
    operation:
      "disable diagnostic interaction tracing when its environment value is unreadable",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Tracing observes interaction behavior only and cannot alter the request, selected value, or error result.",
  },
  "terminal-interaction-trace-write": {
    path: "src/lib/terminal_interaction.ts",
    enclosingFunction: "settle",
    operation: "append one diagnostic interaction trace record",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Tracing observes the already-settled interaction outcome and cannot replace it with a diagnostic write failure.",
  },
  "terminal-playback-failure-clear": {
    path: "src/lib/terminal_playback.ts",
    enclosingFunction: "applyTerminalPlayback",
    operation: "clear the remaining inline frame after playback failure",
    kind: "capability",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The captured playback failure remains authoritative and cursor cleanup cannot replace its error cause.",
  },
  "terminal-playback-fit-fallback": {
    path: "src/lib/terminal_playback.ts",
    enclosingFunction: "playbackStillFits",
    operation:
      "treat an unavailable terminal-size observation as no redraw room",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Failing closed selects the stable transcript path and avoids cursor motion based on an unknown viewport.",
  },
  "terminal-size-read-fallback": {
    path: "src/lib/terminal.ts",
    enclosingFunction: "resolveSize",
    operation:
      "fall back from unavailable console dimensions to environment and defaults",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Terminal dimensions control presentation only and the resolver retains explicit environment and conventional fallback values.",
  },
  "terminal-viewport-sample-fallback": {
    path: "src/lib/terminal.ts",
    enclosingFunction: "sample",
    operation:
      "retain the stable terminal viewport after a live sample failure",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Viewport sampling is presentation-only and retains the last validated dimensions instead of changing command semantics.",
  },
  "test-slot-directory-fallback": {
    path: "src/engine/test_run_slots.ts",
    enclosingFunction: "slotDir",
    operation:
      "run without repository test-slot coordination when its directory cannot be created",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Slot coordination is an optional concurrency cap and an unavailable Git-admin directory must not suppress or alter the requested test run itself.",
  },
  "third-party-package-license-decode-fallback": {
    path: "scripts/third_party_codegen.ts",
    enclosingFunction: "declaredNpmLicense",
    operation:
      "fall back from malformed package metadata to a bundled license file",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The generator still requires authoritative license text and fails if no package file supplies it; malformed metadata alone proves no license.",
  },
  "third-party-payload-compare-fallback": {
    path: "scripts/third_party_codegen.ts",
    enclosingFunction: "sameThirdPartyBundlePayload",
    operation: "report malformed generated third-party modules as unequal",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "Malformed generated content must force regeneration and can never be treated as matching the canonical notices bundle.",
  },
  "toml-number-probe-fallback": {
    path: "src/lib/toml_edit.ts",
    enclosingFunction: "isTomlNumberLiteral",
    operation: "classify a parser-rejected TOML number candidate as invalid",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The probe deliberately maps grammar rejection to false so callers normalize the numeric value before writing TOML.",
  },
  "worktree-hook-live-ports-fallback": {
    path: "src/lib/worktree_hooks.ts",
    enclosingFunction: "worktreeCreateHook",
    operation:
      "omit the advisory live-port snapshot when identity is unavailable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "Worktree creation remains authoritative and port collision narration is explicitly advisory for a caller-supplied identity.",
  },
  "worktree-hook-port-warning-fallback": {
    path: "src/lib/worktree_hooks.ts",
    enclosingFunction: "worktreeCreateHook",
    operation:
      "omit an advisory port collision warning when the new identity is unreadable",
    kind: "direct",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The worktree is already created and the optional warning cannot replace its setup result or infer a port without identity evidence.",
  },
  "worktree-shell-drain-cancel": {
    path: "src/engine/worktree/shell.ts",
    enclosingFunction: "boundDrains",
    operation:
      "cancel a child output reader after the killed-pipe grace period",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The child process and interrupted command outcome are already settled, while the reader may already be closed or errored.",
  },
  "write-preflight-probe-remove": {
    path: "src/shared/write_preflight.ts",
    enclosingFunction: "removeProbe",
    operation: "remove a representative write-preflight probe entry",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The probe result already records whether the planned operation is possible and cleanup cannot replace that structured verdict.",
  },
  "write-preflight-tree-remove": {
    path: "src/shared/write_preflight.ts",
    enclosingFunction: "removeProbeTree",
    operation: "remove a representative write-preflight directory tree",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The probe result already records whether the planned operation is possible and cleanup cannot replace that structured verdict.",
  },
});

/** Stable ID of one registered deliberate error-discard boundary. */
export type BestEffortBoundaryId = keyof typeof BEST_EFFORT_BOUNDARIES;

/** Reporter supplied by an async boundary whose registry policy is observable. */
export type BestEffortReporter = (
  error: unknown,
) => void | Promise<void>;

/** Reporter supplied by a synchronous observable boundary. */
export type BestEffortSyncReporter = (error: unknown) => void;

/** Resolve and validate one capability entry before starting its effect. */
function capabilityBoundary(
  boundaryId: string,
  shape: BestEffortBoundaryShape,
  hasReporter: boolean,
): BestEffortBoundary {
  const boundary = (BEST_EFFORT_BOUNDARIES as Readonly<
    Record<string, BestEffortBoundary>
  >)[boundaryId];
  if (boundary === undefined) {
    throw new TypeError(`unknown best-effort boundary '${boundaryId}'`);
  }
  if (boundary.kind !== "capability") {
    throw new TypeError(
      `best-effort boundary '${boundaryId}' is a direct syntax exception`,
    );
  }
  if (boundary.shape !== shape) {
    throw new TypeError(
      `best-effort boundary '${boundaryId}' is ${boundary.shape}, not ${shape}`,
    );
  }
  const reported = boundary.observability.kind === "reported";
  if (reported !== hasReporter) {
    throw new TypeError(
      reported
        ? `best-effort boundary '${boundaryId}' requires its registered reporter`
        : `unobservable best-effort boundary '${boundaryId}' cannot accept a reporter`,
    );
  }
  return boundary;
}

/**
 * Run an asynchronous secondary side effect without letting its failure replace
 * the primary operation. Validation happens synchronously, and every rejection
 * from the effect or its reporter settles inside the returned promise.
 */
export function bestEffort(
  boundaryId: BestEffortBoundaryId,
  effect: () => Promise<void>,
  reporter?: BestEffortReporter,
): Promise<void> {
  capabilityBoundary(boundaryId, "async", reporter !== undefined);
  return runBestEffort(effect, reporter);
}

/** Contain every rejection from one validated async effect and its reporter. */
async function runBestEffort(
  effect: () => Promise<void>,
  reporter: BestEffortReporter | undefined,
): Promise<void> {
  try {
    await effect();
  } catch (error) {
    if (reporter === undefined) return;
    try {
      await reporter(error);
    } catch {
      // A reporting failure is secondary to the already best-effort effect.
    }
  }
}

/**
 * Run a synchronous secondary side effect without returning a fallback value or
 * allowing its failure to replace the primary operation.
 */
export function bestEffortSync(
  boundaryId: BestEffortBoundaryId,
  effect: () => void,
  reporter?: BestEffortSyncReporter,
): void {
  capabilityBoundary(boundaryId, "sync", reporter !== undefined);
  runBestEffortSync(effect, reporter);
}

/** Contain every throw from one validated sync effect and its reporter. */
function runBestEffortSync(
  effect: () => void,
  reporter: BestEffortSyncReporter | undefined,
): void {
  try {
    effect();
  } catch (error) {
    if (reporter === undefined) return;
    try {
      reporter(error);
    } catch {
      // A reporting failure is secondary to the already best-effort effect.
    }
  }
}
