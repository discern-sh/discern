/** The one sentence both the terminal summary and the Markdown result use. */

import { assertEquals } from "@std/assert";
import { upgradeCommitSentence } from "../src/shared/upgrade_commit_presentation.ts";

Deno.test("the upgrade commit sentence names each outcome and stays silent when nothing changed", () => {
  assertEquals(
    upgradeCommitSentence({
      state: "committed",
      head: "0123456789abcdef0123",
      paths: ["discern.toml", "AGENTS.md"],
    }),
    "Committed the upgrade as `0123456789ab` (2 files).",
  );
  assertEquals(
    upgradeCommitSentence({
      state: "uncommitted",
      reason: "`--allow-dirty` leaves the commit to you.",
    }),
    "Left the upgrade uncommitted: `--allow-dirty` leaves the commit to you.",
  );
  assertEquals(
    upgradeCommitSentence({ state: "failed", reason: "error: policy says no" }),
    "Could not commit the upgrade: error: policy says no",
  );
  assertEquals(upgradeCommitSentence({ state: "unchanged" }), undefined);
  assertEquals(upgradeCommitSentence(undefined), undefined);
});
