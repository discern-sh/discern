/** Shared CLI/MCP explanation of the supported native return action. */
export const EXECUTION_RECOVERY_DESCRIPTION =
  "Recover an abandoned owned execution once native ownership and stopped children are established, without waiting for its validation deadline or running validation or landing.";

/** Execution diagnostics and their registered hint name the same narrow return action. */
export function executionRecoveryCommand(id: string): string {
  return `discern done --recover ${id}`;
}

/** Explain the preservation prerequisite and the owning checkout’s return action. */
export function executionRecoveryHint({ id }: { id: string }): string {
  return `Preserve the retained paths and reconcile the recorded recovery reason. From the owning worktree, run ${
    executionRecoveryCommand(id)
  }. Recovery rechecks native ownership and stopped children; a future validation deadline does not require waiting. This returns the checkout without validation or landing.`;
}
