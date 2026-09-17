import type { ResultAdvisory } from "../shared/result.ts";

/** One typed advisory for current-schema-unknown keys ignored while committed
 * policy was read. The caller may combine the standards and checkpoint reads;
 * sorting and deduplication keep the envelope stable. */
export function governingConfigKeyIgnoredAdvisory(
  paths: readonly string[],
): ResultAdvisory | undefined {
  const unique = [...new Set(paths)].sort();
  if (unique.length === 0) return undefined;
  return {
    kind: "governing-config-key-ignored",
    evidence: unique.map((path) =>
      `The governing configuration ignored the unrecognized key '${path}'.`
    ),
    next_action:
      "Review each ignored key. If it should still govern, add its retired-key redirect before migrating the committed configuration; otherwise remove it from the trunk, update this worktree, and rerun the command.",
  };
}
