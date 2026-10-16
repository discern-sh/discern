/**
 * Standards hints: measuring, pinning, and proposing quality limits.
 * Entries are registered here and fired only through `HINTS` in `../hints.ts`.
 */

import { discernCommand, flag } from "../command_reference.ts";
import { productSentence } from "../product_sentence.ts";
import type { GitCount } from "../git_count.ts";
import {
  boundedNameSummary,
  CMD,
  defineHint,
  HINT_NAME_CAP,
} from "./define.ts";

/** The standards catalog, keyed by hint id. */
export const STANDARDS_HINTS = {
  /** The pin pass has no configured metric to measure or tighten. */
  "standards-pin-empty": defineHint({
    id: "standards-pin-empty",
    category: "notice",
    audience: "all",
    when: "`standards --pin` finds no configured standards.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "No standards configured, so there is nothing to pin.",
  }),

  /** Pin previews honor the universal dry-run contract and measure nothing. */
  "standards-pin-dry-run": defineHint({
    id: "standards-pin-dry-run",
    category: "next-step",
    audience: "all",
    when: "`standards --pin --dry-run` previews without measuring.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("standards")
      } to measure once and find pinnable slack. Then run ` +
      `${
        discernCommand("standards", flag("pin"))
      } on the same clean commit to reuse those ` +
      "measurements. A pin dry-run measures nothing.",
  }),

  /** Same-commit evidence supplied one or more measurements for the pin pass. */
  "standards-pin-reused-measurements": defineHint({
    id: "standards-pin-reused-measurements",
    category: "notice",
    audience: "all",
    when:
      "`standards --pin` reuses one or more measurements from same-commit evidence.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "Available measurements were reused for this commit. Missing selected measurements ran through their shared process groups.",
  }),

  /** A red standard blocks the whole pin rather than capturing a failing state. */
  "standards-pin-blocked": defineHint<{
    failingNames: readonly string[];
  }>({
    id: "standards-pin-blocked",
    category: "next-step",
    audience: "all",
    when: "`standards --pin` finds one or more failing standards.",
    family: "standards-pin",
    example: { failingNames: ["coverage", "bundle_size"] },
    template: ({ failingNames }): string => {
      const named = failingNames.length > 0
        ? boundedNameSummary(failingNames.length, failingNames)
        : "a standard";
      const singular = failingNames.length <= 1;
      return `Fix ${named}, then re-run ${
        discernCommand("standards", flag("pin"))
      } once green. ${
        singular ? "It is" : "They are"
      } failing, and diagnostics[] carries ${
        singular ? "the reason" : "each reason"
      }. No limits were pinned.`;
    },
  }),

  /** Every selected standard already equals its measured, margin-adjusted limit. */
  "standards-pin-no-slack": defineHint({
    id: "standards-pin-no-slack",
    category: "notice",
    audience: "all",
    when: "`standards --pin` finds no tighter limit to capture.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "Nothing to pin. Every selected standard already sits at its measured value within its margin.",
  }),

  /** The pin commit moved beyond every exact-HEAD Proof. */
  "standards-pin-no-proof": defineHint({
    id: "standards-pin-no-proof",
    category: "next-step",
    audience: "all",
    when: "A pin commit invalidates the prior exact-HEAD Proof.",
    example: undefined,
    template: (): string => `Run ${CMD.done}; this pin has no current Proof.`,
  }),

  /** Standalone standards could not verify the branch limits against the trunk. */
  "standards-limits-unverified": defineHint<{
    reason: string | undefined;
  }>({
    id: "standards-limits-unverified",
    category: "next-step",
    audience: "all",
    when: "`standards` cannot compare branch limits with the trunk.",
    family: "standards-limits-unverified",
    example: { reason: "the local trunk is missing" },
    template: ({ reason }): string =>
      `Standards limits are UNVERIFIED. Fetch the trunk where standards run so ` +
      `the limits can be verified. The never-loosen check could not read it (` +
      `${reason ?? "unknown"}).`,
  }),

  /** Pinning a branch behind the trunk may capture limits that an update invalidates. */
  "standards-pin-behind": defineHint<{
    behind: GitCount;
    trunk: string;
  }>({
    id: "standards-pin-behind",
    category: "next-step",
    audience: "all",
    when: "`standards --pin` runs on a branch behind the trunk.",
    family: "standards-pin",
    example: { behind: 2, trunk: "main" },
    template: ({ behind, trunk }): string => {
      const commits = behind === 1 ? "commit" : "commits";
      return `Run ${CMD.update} before pinning against the latest trunk. ` +
        `This worktree is ${behind} ${commits} behind ${trunk}, so its measured ` +
        "values may not survive the update.";
    },
  }),

  /** The standalone check has no configured standards to measure. */
  "standards-none-configured": defineHint({
    id: "standards-none-configured",
    category: "next-step",
    audience: "all",
    when: "`standards` finds no configured standards.",
    example: undefined,
    template: (): string =>
      "Add a [standards.<name>] table to measure a standard. No standards configured.",
  }),

  /** A green check found tighter limits that the pin pass can capture. */
  "standards-pinnable-slack": defineHint<{
    standards: readonly {
      name: string;
      bound: "floor" | "ceiling";
      limit: number;
      measured: string;
      newLimit: number;
    }[];
    proofed: boolean;
  }>({
    id: "standards-pinnable-slack",
    category: "next-step",
    audience: "all",
    when: "`standards` finds measured slack that can tighten a limit.",
    example: {
      standards: [{
        name: "coverage",
        bound: "floor",
        limit: 90,
        measured: "92.4",
        newLimit: 92.4,
      }],
      proofed: true,
    },
    template: ({ standards, proofed }): string => {
      const shown = standards.slice(0, HINT_NAME_CAP);
      const slack = shown.map((standard) =>
        `${standard.name} (${standard.bound} ${standard.limit}, measured ${standard.measured}, pinning to ${standard.newLimit})`
      );
      const summary = slack.length > 0
        ? slack.join("; ")
        : "review the reported standards";
      const remaining = Math.max(0, standards.length - shown.length);
      const overflow = remaining > 0
        ? ` ${remaining} more standard${
          remaining === 1 ? " is" : "s are"
        } eligible.`
        : "";
      const lead = productSentence(
        `Run ${
          discernCommand("standards", flag("pin"))
        } to capture pinnable slack: ${summary}`,
      );
      return `${lead}${overflow} ${
        proofed
          ? "On this commit, the pin reuses this check's measurements"
          : "This check already measured, so no pin dry-run is needed"
      }.`;
    },
  }),
} as const;
