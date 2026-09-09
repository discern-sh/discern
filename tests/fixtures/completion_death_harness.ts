/** The parent kills a real native executor at an observed publication or phase boundary. */
import { operationLockChildEnv } from "../../src/shared/operation_lock_context.ts";
import { spawnJob } from "../../src/engine/jobs/command.ts";
import { quoteCommandWord } from "../../src/shared/command_evidence.ts";
import { assertExists } from "@std/assert";
import { withPublicCompletion } from "../../src/engine/landing_queue/public_completion.ts";
import { recoverCompletionResult } from "../../src/engine/execution/public_recovery.ts";

const [boundary, marker, environmentId] = Deno.args;
assertExists(boundary);
assertExists(marker);

/** The owning test supplies a bounded lifetime and forcibly reaps this process. */
async function pause(): Promise<void> {
  assertExists(marker);
  await Deno.writeTextFile(marker + ".delegation", JSON.stringify(operationLockChildEnv()));
  await Deno.writeTextFile(marker, "ready");
  await Deno.stdin.read(new Uint8Array(1));
}

if (environmentId === undefined) {
  await withPublicCompletion(Deno.cwd(), {
    context: "local", mode: "strict",
    afterClaim: async (phase) => {
      if (boundary === phase) await pause();
    },
  }, async (session) => {
    await Deno.writeTextFile("executions", "v", { append: true });
    if (boundary === "surviving-child") {
      await spawnJob({ label: "barrier", command:
        `printf ready > ${quoteCommandWord(marker)}; IFS= read -r acknowledgement < ${quoteCommandWord(marker + ".fifo")}`,
      }, { cwd: Deno.cwd(), signal: session.execution.signal, stream: false, write: () => {} });
    } else await pause();
    return { value: false, passed: false };
  });
} else {
  const result = await recoverCompletionResult(Deno.cwd(), environmentId, false, {
    afterRecoveryPublication: async (phase) => {
      if (boundary === phase) await pause();
    },
    afterPhase: async (phase) => {
      if (boundary === phase) await pause();
    },
    afterReturn: async () => {
      if (boundary === "returned") await pause();
    },
  });
  if (!result.ok) throw new Error(result.message);
}
