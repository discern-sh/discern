/**
 * Every shipped path that can overwrite a compiled agent file, and where each
 * reports what the overwrite discards.
 *
 * Agent files are whole-file generated outputs, so an overwrite throws away
 * every line no instruction source produces. One writer, the refresh executor
 * `applyRefreshPlan`, applies those overwrites: the refresh planner compares
 * each file through `agentFileDiscard` before planning its write, and the
 * executor records what each write threw away. The guard
 * (`tests/agent_file_writers_guard_test.ts`) enrolls two closed sets by call
 * site, so a new path fails the gate until it is declared here:
 *
 * - every use of the compiled agent-file render, where only the refresh
 *   planner may turn rendered bytes into a write;
 * - every call of the writer, and of each function that hands its report on,
 *   declaring how the report reaches the caller.
 */

/** The functions that produce compiled agent-file bytes. */
export const AGENT_FILE_RENDERERS: readonly string[] = [
  "renderAgentFiles",
  "agentFileContents",
];

/** What a site does with rendered agent-file bytes. */
export type AgentFileRenderPosture =
  | "plan"
  | "render"
  | "compare"
  | "paths"
  | "ownership";

/** The meaning of each render posture — the contract a declaration asserts. */
export const AGENT_FILE_RENDER_POSTURES: Readonly<
  Record<AgentFileRenderPosture, string>
> = {
  plan:
    "Turns rendered bytes into planned writes, each carrying what it discards. Only the refresh planner may hold this posture.",
  render: "Composes the rendered bytes inside the renderer itself.",
  compare: "Compares rendered bytes with disk; writes nothing.",
  paths: "Reads only the rendered paths; never the bytes.",
  ownership:
    "Recognizes discern's own earlier output during setup adoption; writes nothing.",
};

/** One render-site declaration. */
export interface AgentFileRenderUse {
  readonly posture: AgentFileRenderPosture;
  readonly why: string;
}

/** Every shipped use of a renderer, keyed `<module>#<function> > <renderer>`. */
export const AGENT_FILE_RENDER_USES: Readonly<
  Record<string, AgentFileRenderUse>
> = {
  "src/commands/doctor.ts#runChecks > renderAgentFiles": {
    posture: "paths",
    why: "Lists the agent files the configured agents read.",
  },
  "src/engine/instruction_render.ts#agentFileOwnershipPatterns > agentFileContents":
    {
      posture: "ownership",
      why:
        "Builds the patterns setup matches an existing file against before adopting it.",
    },
  "src/engine/instruction_render.ts#agentFilePaths > agentFileContents": {
    posture: "paths",
    why: "Derives the emitted paths from an empty body.",
  },
  "src/engine/instruction_render.ts#checkInstructionCurrent > renderAgentFiles":
    {
      posture: "compare",
      why: "The currency check behind status and the gate.",
    },
  "src/engine/instruction_render.ts#renderAgentFiles > agentFileContents": {
    posture: "render",
    why: "The renderer's own composition of every agent file's body.",
  },
  "src/engine/tracked_refresh.ts#planRefresh > renderAgentFiles": {
    posture: "plan",
    why:
      "Plans every agent-file write and attaches agentFileDiscard's verdict to it.",
  },
  "src/engine/worktree/lifecycle.ts#updateRefreshCompiledPaths > renderAgentFiles":
    {
      posture: "paths",
      why: "Names the compiled paths an update may regenerate.",
    },
};

/** The writer and every function that hands its discard report on. */
export const AGENT_FILE_WRITE_CHAIN: readonly string[] = [
  "applyRefreshPlan",
  "compileInstructions",
  "refreshResult",
  "refreshWorktreeArtifacts",
  "runUpdateConvergence",
  "worktreeSetup",
  "worktreeEnsure",
  "createAndSetupWorktree",
  "applyUpdateCore",
  "proveComposition",
  "runIntegrationAttempt",
  "scaffoldHarness",
  "refreshSetupInstructions",
  "proveFinalSetupTree",
];

/** A behavioural test, named by file and exact test name. */
export interface DiscardProof {
  readonly file: string;
  readonly test: string;
}

/** How one call in the write chain lets its caller learn what was discarded. */
export type AgentFileWriteUse =
  /** Applies the plan and records each discard; only the refresh module. */
  | { readonly role: "writer"; readonly why: string }
  /** The enclosing function's own result reports the discard. */
  | { readonly role: "reports"; readonly proof: DiscardProof }
  /** Reports through the same result assembly as another, proven use. */
  | { readonly role: "reports"; readonly sameAs: string; readonly why: string }
  /** The enclosing function returns the report; `via` is its own name, an
   * enrolled chain member whose every call is declared here too. */
  | { readonly role: "forwards"; readonly via: string }
  /** The called function renders its own result, which carries the report. */
  | { readonly role: "emitted"; readonly why: string }
  /** No result reaches a caller; the writer's warning narrates the discard. */
  | { readonly role: "narrated"; readonly why: string };

const REFRESH_PROOF: DiscardProof = {
  file: "tests/engine_refresh_test.ts",
  test:
    "engine refresh: every agent-file overwrite reports the lines it discards — refresh, its dry run, and prepare",
};

const LIFECYCLE_PROOF: DiscardProof = {
  file: "tests/engine_update_summary_test.ts",
  test:
    "start, update, and worktree ensure report agent-file lines their refresh discards",
};

/** Every shipped call in the write chain, keyed `<module>#<function> > <callee>`. */
export const AGENT_FILE_WRITE_USES: Readonly<
  Record<string, AgentFileWriteUse>
> = {
  "src/commands/setup.ts#proveFinalSetupTree > refreshSetupInstructions": {
    role: "forwards",
    via: "proveFinalSetupTree",
  },
  "src/commands/setup.ts#refreshSetupInstructions > compileInstructions": {
    role: "forwards",
    via: "refreshSetupInstructions",
  },
  "src/commands/setup.ts#runExistingSetupCompletion > proveFinalSetupTree": {
    role: "reports",
    sameAs: "src/commands/setup.ts#runSetupDone > refreshSetupInstructions",
    why:
      "Renders the same refresh failure detail and hints as the refusal message.",
  },
  "src/commands/setup.ts#runSetupBegin > compileInstructions": {
    role: "reports",
    sameAs: "src/commands/setup.ts#runSetupBegin > scaffoldHarness",
    why: "Merges its refresh hints into the same setup hints.",
  },
  "src/commands/setup.ts#runSetupBegin > scaffoldHarness": {
    role: "reports",
    proof: {
      file: "tests/cli_test.ts",
      test:
        "setup begin --reseed re-scaffolds an existing install without erroring, reporting what its compile discards",
    },
  },
  "src/commands/setup.ts#runSetupDone > proveFinalSetupTree": {
    role: "reports",
    sameAs: "src/commands/setup.ts#runSetupDone > refreshSetupInstructions",
    why:
      "Renders the same refresh failure detail and hints as the refusal message.",
  },
  "src/commands/setup.ts#runSetupDone > refreshSetupInstructions": {
    role: "reports",
    proof: {
      file: "tests/engine_setup_done_test.ts",
      test:
        "setup done blocks when the refresh proof only partially completes, or when it discards agent-file lines",
    },
  },
  "src/commands/setup.ts#scaffoldHarness > compileInstructions": {
    role: "forwards",
    via: "scaffoldHarness",
  },
  "src/commands/upgrade.ts#runUpgrade > compileInstructions": {
    role: "reports",
    proof: {
      file: "tests/upgrade_edge_test.ts",
      test:
        "upgrade fills agents from defaults when discern.toml carries no agents key, reporting what its compile discards",
    },
  },
  "src/engine/desk/desk.ts#setup > worktreeSetup": {
    role: "emitted",
    why: "worktreeSetup emits the setup result, whose hints carry the report.",
  },
  "src/engine/dispatch.ts#attachEngineCommands > refreshResult": {
    role: "reports",
    proof: REFRESH_PROOF,
  },
  "src/engine/dispatch.ts#attachEngineCommands > worktreeEnsure": {
    role: "reports",
    proof: LIFECYCLE_PROOF,
  },
  "src/engine/dispatch.ts#attachEngineCommands > worktreeSetup": {
    role: "emitted",
    why: "worktreeSetup emits the setup result, whose hints carry the report.",
  },
  "src/engine/gate/prepare.ts#runPrepareRefresh > compileInstructions": {
    role: "reports",
    proof: REFRESH_PROOF,
  },
  "src/engine/instructions.ts#compileInstructions > applyRefreshPlan": {
    role: "writer",
    why: "Applies a fresh plan for lifecycle callers.",
  },
  "src/engine/instructions.ts#refreshResult > applyRefreshPlan": {
    role: "writer",
    why: "Applies the refresh verb's plan.",
  },
  "src/engine/mcp/server.ts#run > refreshResult": {
    role: "reports",
    proof: {
      file: "tests/engine_mcp_test.ts",
      test:
        "discern mcp: initialize, tools/list, and tools/call render DiscernResults",
    },
  },
  "src/engine/worktree/accept_integration.ts#executeIntegrationLanding > runIntegrationAttempt":
    {
      role: "reports",
      proof: {
        file: "tests/engine_accept_gate_test.ts",
        test:
          "accept: a trunk that moved after the Proof composes in an integration worktree and never reruns the gate in the author's checkout",
      },
    },
  "src/engine/worktree/integration_landing.ts#proveComposition > applyUpdateCore":
    { role: "forwards", via: "proveComposition" },
  "src/engine/worktree/integration_landing.ts#runIntegrationAttempt > createAndSetupWorktree":
    { role: "forwards", via: "runIntegrationAttempt" },
  "src/engine/worktree/integration_landing.ts#runIntegrationAttempt > proveComposition":
    { role: "forwards", via: "runIntegrationAttempt" },
  "src/engine/worktree/lifecycle.ts#applyStartPlan > createAndSetupWorktree": {
    role: "reports",
    proof: LIFECYCLE_PROOF,
  },
  "src/engine/worktree/lifecycle.ts#applyUpdateCore > runUpdateConvergence": {
    role: "forwards",
    via: "applyUpdateCore",
  },
  "src/engine/worktree/lifecycle.ts#createAndSetupWorktree > worktreeSetup": {
    role: "forwards",
    via: "createAndSetupWorktree",
  },
  "src/engine/worktree/lifecycle.ts#executeUpdatePlan > applyUpdateCore": {
    role: "reports",
    proof: LIFECYCLE_PROOF,
  },
  "src/engine/worktree/lifecycle.ts#probeWorktreeViability > worktreeSetup": {
    role: "narrated",
    why:
      "A disposable probe of the committed tree whose refresh setup's own proof already reported.",
  },
  "src/engine/worktree/lifecycle.ts#refreshWorktreeArtifacts > compileInstructions":
    { role: "forwards", via: "refreshWorktreeArtifacts" },
  "src/engine/worktree/lifecycle.ts#runUpdateConvergence > compileInstructions":
    { role: "forwards", via: "runUpdateConvergence" },
  "src/engine/worktree/lifecycle.ts#worktreeEnsure > worktreeSetup": {
    role: "forwards",
    via: "worktreeEnsure",
  },
  "src/engine/worktree/lifecycle.ts#worktreeSetup > refreshWorktreeArtifacts": {
    role: "forwards",
    via: "worktreeSetup",
  },
  "src/lib/worktree_hooks.ts#worktreeCreateHook > createAndSetupWorktree": {
    role: "narrated",
    why:
      "A provider hook prints the new path; its narration carries the writer's warning.",
  },
};
