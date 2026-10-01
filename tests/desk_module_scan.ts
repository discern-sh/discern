/**
 * One scan over every authored Desk module for structural guards whose rule
 * holds across the Desk subtree. The scope is declared once here, so each
 * guard states only its rule: the finder that reports a module's violations
 * and, when one module owns the rule, that module's exemption.
 */

import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** One Desk-wide structural rule. */
export interface DeskModuleRule {
  /** The module that owns the rule and may do what others may not. */
  readonly owner?: string;
  /** Every violation in one module's source, as short descriptions. */
  readonly scan: (source: string, file: string) => readonly string[];
}

/** The Desk modules a rule covers, and every violation found in them. */
export interface DeskModuleScan {
  readonly files: readonly string[];
  readonly findings: readonly string[];
}

/** Scan every authored Desk module but the rule's owner. */
export async function scanDeskModules(
  rule: DeskModuleRule,
): Promise<DeskModuleScan> {
  const files = await structuralGuardScope({
    guard: "tests/desk_module_scan.ts#desk-subtree",
    universe: "authored-ts",
    narrow: {
      reason:
        "The rule governs how the Desk subtree composes its rows and text; status and other commands keep their own presenters.",
      include: (path) => path.startsWith("src/engine/desk/"),
    },
  });
  const findings: string[] = [];
  for (const file of files) {
    if (file === rule.owner) continue;
    const source = await Deno.readTextFile(join(REPO_ROOT, file));
    findings.push(...rule.scan(source, file).map((hit) => `${file} ${hit}`));
  }
  return { files, findings };
}
