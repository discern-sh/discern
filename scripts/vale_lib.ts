/**
 * The stable caller surface for Vale. Provisioning and the exact process
 * boundary live in `vale_toolchain.ts`; authored prose callers import here.
 */

import {
  parseValeVersion,
  runProvisionedVale,
  type ValeToolchainOptions,
} from "./vale_toolchain.ts";

export { parseValeVersion };

/** Run the tracked Vale version or fail with one actionable correction. */
export async function runVale(
  repoRoot: string,
  args: string[],
  options: ValeToolchainOptions = {},
): Promise<Deno.CommandOutput> {
  return await runProvisionedVale(repoRoot, args, options);
}
