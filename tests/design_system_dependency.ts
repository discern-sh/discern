/** Temporary package-source contract for the serial Desk adoption programme. */
import { assertEquals } from "@std/assert";
import { toFileUrl } from "@std/path";

export const DESIGN_SYSTEM_VERSION = "0.31.0";
export const DESIGN_SYSTEM_SPECIFIER =
  `jsr:@discern-sh/design-system@${DESIGN_SYSTEM_VERSION}`;
export const DESIGN_SYSTEM_WORKTREE =
  "/Users/jack/Sites/discern-design-system.worktrees/calm-1a-prerequisites-dafbe4";
export const DESIGN_SYSTEM_BRANCH = "agent/calm-1a-prerequisites-dafbe4";
export const DESIGN_SYSTEM_ORIGIN =
  toFileUrl(`${DESIGN_SYSTEM_WORKTREE}/`).href;

/** Verify the assigned branch while allowing its source to evolve. */
export async function assertDevelopmentWorktree(
  worktree: string,
  branch: string,
): Promise<void> {
  const result = await new Deno.Command("git", {
    args: ["-C", worktree, "branch", "--show-current"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  assertEquals(new TextDecoder().decode(result.stdout).trim(), branch);
}
