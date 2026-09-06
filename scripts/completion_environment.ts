/** Converge the declared repository and worktree procedures with required failure semantics. */
import { Logger } from "../src/lib/log.ts";
import {
  lifecycleContext,
  worktreeEnsure,
} from "../src/engine/worktree/lifecycle.ts";

/** Resolve the invocation path once; nested lifecycle operations receive it explicitly. */
async function main(root = Deno.cwd()): Promise<void> {
  const context = await lifecycleContext(
    root,
    new Logger({ json: false, noColor: true }),
  );
  const result = await worktreeEnsure(context, { required: true });
  if (result.kind === "skipped") {
    throw new Error(
      "The repository completion environment requires its positively owned linked worktree.",
    );
  }
}
await main();
