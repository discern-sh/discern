/** Detached checkouts keep the identity recorded before candidate installation. */
import { runGit } from "../../shared/subprocess.ts";
import { enrolledEnvironments } from "./enrollment_read.ts";
import { loadExecutionIntent } from "./intent.ts";
import {
  type WorkspaceState,
  WorkspaceStateSchema,
} from "./workspace_state.ts";

/** Observation only: malformed execution provenance must not become guessed identity. */
export async function frozenExecutionContext(
  path: string,
): Promise<WorkspaceState | undefined> {
  const attached = await runGit(["symbolic-ref", "-q", "HEAD"], { cwd: path });
  if (attached.success) return undefined;
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: path,
  });
  if (!inside.success || inside.stdout.trim() !== "true") return undefined;
  const canonical = await Deno.realPath(path);
  const matches = (await enrolledEnvironments(canonical)).filter((record) =>
    record.data.path === canonical &&
    (record.data.state.kind === "executing" ||
      record.data.state.kind === "recovery")
  );
  if (matches.length === 0) return undefined;
  const record = matches[0];
  if (record === undefined || matches.length !== 1) {
    throw new Error(
      "Detached checkout has conflicting execution ownership; reconcile the environment records before deriving identity.",
    );
  }
  const state = record.data.state;
  if (state.kind !== "executing" && state.kind !== "recovery") {
    throw new Error(
      "Detached execution state changed during identity observation.",
    );
  }
  const intent = await loadExecutionIntent(
    canonical,
    state.attempt_id,
    record.id,
  );
  if (
    JSON.stringify(intent.environment.ownership) !==
      JSON.stringify(record.data.ownership) ||
    intent.environment.path !== canonical ||
    intent.environment.declaration !== record.data.declaration
  ) {
    throw new Error(
      "Detached checkout identity disagrees with its frozen execution intent; preserve the checkout for recovery.",
    );
  }
  return WorkspaceStateSchema.parse(intent.source.value);
}
