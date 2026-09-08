/** Required host capabilities; none can infer release from a clean checkout. */
import type { EnvironmentDeclaration } from "../../shared/config_schema.ts";
import type {
  CompletionRecovery,
  ExecutionEnvironment,
} from "../completion/environment.ts";
import type { ClaimedExecution } from "../completion/protocol.ts";
import type { ArtifactSchema } from "../completion/evidence.ts";
import type { z } from "@zod/zod";

export type EnvironmentArtifact = z.infer<typeof ArtifactSchema>;
export type EnvironmentPhase = Extract<
  ExecutionEnvironment["state"],
  { kind: "executing" }
>["phase"];

/** Held across all effects, without holding a common publication lock. */
export interface ExecutionLifetime {
  inspect(
    path: string,
  ): Promise<{ readonly quiescent: boolean; readonly reason: string }>;
  exclusive<T>(
    path: string,
    execution: { readonly attempt_id: string; readonly token: string },
    operation: () => Promise<T>,
  ): Promise<T>;
  /** A restart must prove old children absent; expiry alone is insufficient. */
  quiesce(path: string, attemptId: string): Promise<boolean>;
}

/** An immutable, JSON-serializable source snapshot owned by the workspace adapter. */
import type { WorkspaceSnapshot } from "./snapshot_schema.ts";
export type { WorkspaceSnapshot } from "./snapshot_schema.ts";

export type ExecutionRecipe = {
  readonly action: "source-tip";
  readonly declaration: null;
} | {
  readonly action: "borrow" | "provision" | "reuse";
  readonly declaration: EnvironmentDeclaration;
};

export interface ExecutionWorkspace {
  inspect(
    environment: ExecutionEnvironment,
    declaration: EnvironmentDeclaration | null,
    observation?: "source" | "recovery" | "release",
  ): Promise<WorkspaceSnapshot>;
  verify(
    environment: ExecutionEnvironment,
    snapshot: WorkspaceSnapshot,
  ): Promise<void>;
  install(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    source: WorkspaceSnapshot,
  ): Promise<WorkspaceSnapshot>;
  run(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    phase: "prepare" | "restore" | "reset" | "dispose",
    signal: AbortSignal,
  ): Promise<void>;
  capture(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
  ): Promise<WorkspaceSnapshot>;
  /** Prove that an isolated reservation never reached installation or preparation. */
  unprovisioned(
    execution: ClaimedExecution,
    source: WorkspaceSnapshot,
    captured: WorkspaceSnapshot,
  ): Promise<boolean>;
  restore(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    source: WorkspaceSnapshot,
    captured: WorkspaceSnapshot,
  ): Promise<void>;
  verifyReturned(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    source: WorkspaceSnapshot,
  ): Promise<void>;
  dispose(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    captured: WorkspaceSnapshot,
  ): Promise<void>;
}

/** Preserve the exact unfinished phase and the paths whose lifetime remains open. */
export function recoveryFor(
  phase: CompletionRecovery["phase"],
  reason: string,
  path: string,
  cleanup: readonly string[],
  quiescent = false,
  drift: CompletionRecovery["drift"] = {
    kind: "uncaptured",
    reason: "Capture has not completed.",
  },
): CompletionRecovery {
  return {
    phase,
    reason,
    children_quiescent: quiescent,
    drift,
    retained_paths: [path],
    frozen_cleanup: [...cleanup],
  };
}

/** Preserve an effect's diagnostic without assigning it a validation verdict. */
export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
