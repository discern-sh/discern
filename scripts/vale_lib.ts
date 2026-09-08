/**
 * The stable caller surface for Vale. Provisioning and the exact process
 * boundary live in `vale_toolchain.ts`; authored prose callers import here.
 */

import {
  parseValeVersion,
  runProvisionedVale,
  type ValeToolchainOptions,
} from "./vale_toolchain.ts";

import { resolve } from "@std/path";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { runningMarkdownProse } from "./markdown_prose.ts";
import { valeReportSchema } from "./prose_lib.ts";

export { parseValeVersion };

/**
 * Vale can join a link title to the words outside its label. Recheck canonical
 * casing matches against parsed source boundaries, preserving uncertain reports
 * and every other rule. All prose consumers request JSON so the gate, review,
 * editor, and density measurement receive the same source-backed findings.
 */
async function sourceBackedCasing(
  repoRoot: string,
  output: Deno.CommandOutput,
): Promise<Deno.CommandOutput> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(output.stdout));
  } catch {
    return output;
  }
  const parsed = valeReportSchema.safeParse(decoded);
  if (!parsed.success) return output;
  let changed = false;
  for (const [path, alerts] of Object.entries(parsed.data)) {
    if (!path.endsWith(".md")) continue;
    if (
      !alerts.some((alert) =>
        alert.Check === "DiscernProduct.CanonicalTermCase"
      )
    ) continue;
    const source = await readTextIfExists(resolve(repoRoot, path));
    if (source === undefined) {
      for (const alert of alerts) {
        if (alert.Check !== "DiscernProduct.CanonicalTermCase") continue;
        alert.Message = `${alert.Message ?? "Canonical casing finding"} ` +
          "Source context is no longer available; the finding is retained.";
      }
      changed = true;
      continue;
    }
    const prose = runningMarkdownProse(source);
    const lines = prose.split("\n");
    parsed.data[path] = alerts.filter((alert) => {
      if (
        alert.Check !== "DiscernProduct.CanonicalTermCase" ||
        alert.Match === undefined || alert.Line === undefined ||
        alert.Line > lines.length
      ) return true;
      const pattern = alert.Match.trim().split(/\s+/u).map((word) =>
        word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
      ).join("\\s+");
      if (pattern === "") return true;
      const rest = lines.slice(alert.Line - 1).join("\n");
      const firstLineLength = lines[alert.Line - 1]?.length ?? 0;
      const match = new RegExp(pattern, "u").exec(rest);
      const supported = match !== null && match.index <= firstLineLength;
      if (!supported) changed = true;
      return supported;
    });
  }
  if (!changed) return output;
  const hasFindings = Object.values(parsed.data).some((alerts) =>
    alerts.length
  );
  const code = output.code === 1 && !hasFindings && output.stderr.length === 0
    ? 0
    : output.code;
  return {
    ...output,
    code,
    success: code === 0,
    stdout: new TextEncoder().encode(JSON.stringify(parsed.data)),
  };
}

/** Run the tracked Vale version or fail with one actionable correction. */
export async function runVale(
  repoRoot: string,
  args: string[],
  options: ValeToolchainOptions = {},
): Promise<Deno.CommandOutput> {
  return await sourceBackedCasing(
    repoRoot,
    await runProvisionedVale(repoRoot, args, options),
  );
}
