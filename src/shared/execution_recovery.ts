/** Execution diagnostics and their registered hint name the same narrow return action. */
export function executionRecoveryCommand(id: string): string {
  return `discern done --recover ${id}`;
}

/** Explain the preservation prerequisite and the owning checkout’s return action. */
export function executionRecoveryHint({ id }: { id: string }): string {
  return `Preserve the retained paths and reconcile the recorded recovery reason. From the owning worktree, run ${
    executionRecoveryCommand(id)
  }. This returns the checkout without validation or landing.`;
}
