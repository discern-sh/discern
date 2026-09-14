/** Host the shared docs browser over a disposable corpus inside the production Desk. */
import { runDesk } from "../../src/engine/desk/desk.ts";
import { runMap } from "../../src/commands/docs.ts";
const directory = Deno.args[0];

Deno.exit(await runDesk({}, {
  ...(directory === undefined ? {} : { docs: () => runMap({dir: directory, json: false, noColor: true, raw: false, list: false, pager: false, returnLabel: "Return to Desk"}) }),
}));
