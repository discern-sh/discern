/** Temporary package-source contract for the serial Desk adoption programme. */
import { assertEquals } from "@std/assert";
import { toFileUrl } from "@std/path";

export const DESIGN_SYSTEM_VERSION = "0.31.0";
export const DESIGN_SYSTEM_SPECIFIER =
  `jsr:@discern-sh/design-system@${DESIGN_SYSTEM_VERSION}`;
export const DESIGN_SYSTEM_WORKTREE =
  "/Users/jack/Sites/discern-design-system.worktrees/calm-1a-prerequisites-dafbe4";
export const DESIGN_SYSTEM_REVISION =
  "6673e3774843720790cd87281acaaad8cc6e1f8e";
export const DESIGN_SYSTEM_ORIGIN =
  toFileUrl(`${DESIGN_SYSTEM_WORKTREE}/`).href;

/** Require a committed descendant of the reviewed foundation on its retained branch. */
export async function assertDesignSystemWorktree(): Promise<void> {
  const git = async (...args: string[]): Promise<string> => {
    const result = await new Deno.Command("git", {
      args: ["-C", DESIGN_SYSTEM_WORKTREE, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  };
  assertEquals(
    await git("branch", "--show-current"),
    "agent/calm-1a-prerequisites-dafbe4",
  );
  assertEquals(
    await git("status", "--porcelain", "--untracked-files=normal"),
    "",
    "Commit the upstream source after focused checks before validating its consumer; 4A owns the final upstream gate and release.",
  );
  assertEquals(
    await git("rev-parse", "HEAD"),
    DESIGN_SYSTEM_REVISION,
    "Refresh the consumer source receipt after committing an upstream change.",
  );
  await git(
    "merge-base",
    "--is-ancestor",
    "c486b14d74a6e2d74ee096704db26e2f3ed8a8e7",
    "HEAD",
  );
}
