/** Host the shared docs browser over a disposable corpus inside the production Desk. */
import { runDesk } from "../../src/engine/desk/desk.ts";
import { readDocsBrowser } from "../../src/commands/docs.ts";
import { DESK_MANUAL_EXIT } from "../../src/engine/desk/manual.ts";

const directory = Deno.args[0];

Deno.exit(
  await runDesk({}, {
    ...(directory === undefined ? {} : {
      manual: () =>
        readDocsBrowser("map", { dir: directory, exitLabel: DESK_MANUAL_EXIT }),
    }),
  }),
);
