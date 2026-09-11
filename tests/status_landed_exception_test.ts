/**
 * An emergency-landed trunk tip reads the same on every status surface: the
 * reading's facts, whether a later complete run settled the skipped checks,
 * and the one sentence a person reads about it.
 */
import { assertEquals } from "@std/assert";
import {
  landedExceptionSentence,
  landedExceptionStatus,
} from "../src/engine/status/landed_exception.ts";

const reading = {
  status: "exception" as const,
  commit: "a".repeat(40),
  ref: "refs/heads/main",
  landing_id: "landing-1",
  reason: "the site is down",
  exceptions: 2,
};

Deno.test("an exception reading is outstanding while its landing awaits validation, resolved after", () => {
  const outstanding = landedExceptionStatus(reading, [
    { landing_id: "landing-1" },
  ]);
  assertEquals(outstanding, {
    commit: "a".repeat(40),
    ref: "refs/heads/main",
    landing_id: "landing-1",
    reason: "the site is down",
    exceptions: 2,
    validation: "outstanding",
  });
  assertEquals(
    landedExceptionStatus(reading, [{ landing_id: "another" }]).validation,
    "resolved",
  );
  assertEquals(landedExceptionStatus(reading, []).validation, "resolved");
});

Deno.test("the sentence names the reason, counts the skipped checks, and gives the trunk its next command", () => {
  const outstanding = landedExceptionStatus(reading, [
    { landing_id: "landing-1" },
  ]);
  assertEquals(
    landedExceptionSentence(outstanding),
    "The trunk tip landed as an emergency with no passing Proof: the site is down. Its skipped checks are still outstanding; run discern done --rerun on the trunk.",
  );
  assertEquals(
    landedExceptionSentence({ ...outstanding, exceptions: 1 }),
    "The trunk tip landed as an emergency with no passing Proof: the site is down. Its skipped check is still outstanding; run discern done --rerun on the trunk.",
  );
  assertEquals(
    landedExceptionSentence({ ...outstanding, validation: "resolved" }),
    "The trunk tip landed as an emergency with no passing Proof: the site is down. A later complete run settled its skipped checks; the emergency record stays in the history.",
  );
});
