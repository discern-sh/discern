/**
 * Where the landing walk stopped is a fact about the selected effort only when
 * that effort was approved and an entry ahead of it could not land. An
 * unapproved effort waits on its own approval wherever the walk stops.
 */
import { assertEquals } from "@std/assert";
import { walkStoppedBefore } from "../src/engine/landing_queue/public_accept.ts";

const rows = [
  { effort: "first", state: "landed" },
  { effort: "middle", state: "pending" },
  { effort: "last", state: "pending" },
];

Deno.test("an unapproved effort is never reported as not reached", () => {
  assertEquals(walkStoppedBefore("last", null, rows), undefined);
});

Deno.test("an approved effort names the unlanded entry the walk stopped at", () => {
  assertEquals(
    walkStoppedBefore("last", "authority-1", rows)?.effort,
    "middle",
  );
  assertEquals(
    walkStoppedBefore("last", "authority-1", [
      { effort: "first", state: "landed" },
      { effort: "last", state: "pending" },
    ]),
    undefined,
  );
});
