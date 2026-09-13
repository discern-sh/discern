/** A separately spawned publisher reports real contention before touching its body. */
import { withCompletionPublication } from "../../src/engine/operation_lock.ts";
import { withCompletionObserver } from "../../src/engine/completion/events.ts";
const [root, waiting, published] = Deno.args;
if (root === undefined || waiting === undefined || published === undefined) throw new Error("Missing fixture paths.");
await withCompletionObserver(async (fact) => {
  if (fact.kind === "wait" && fact.wait.kind === "repository-update" && fact.wait.state === "waiting") {
    await Deno.writeTextFile(waiting, "waiting");
  }
}, () => withCompletionPublication(root, () => Deno.writeTextFile(published, "published", {append: true})));
