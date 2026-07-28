/** Runtime behavior of discern's attributed, pathspec-limited commit boundary. */

import { assertEquals } from "@std/assert";
import { DISCERN_BOT } from "../src/shared/brand.ts";
import { discernCommitMessage } from "../src/shared/discern_commit.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import {
  GIT_ALIAS_BOUNDARY_ERROR,
  GIT_COMMIT_BOUNDARY_ERROR,
  runGit,
} from "../src/shared/subprocess.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";

Deno.test("the generic git runner refuses commit through aliases and wrappers", async () => {
  await withTempDir(async (cwd) => {
    const ferry = runGit;
    const wrapped = (args: string[]) => ferry(args, { cwd });
    const result = await wrapped([
      "-c",
      "user.name=Unrelated",
      "commit",
      "-m",
      "Bypass",
    ]);
    assertEquals(result.code, 2);
    assertEquals(result.success, false);
    assertEquals(result.stderr, GIT_COMMIT_BOUNDARY_ERROR);
  });
});

Deno.test("the generic git runner permits commit only as later data", async () => {
  await withTempDir(async (cwd) => {
    await Deno.mkdir(`${cwd}/commit`);
    const result = await runGit(
      [
        "-C",
        "commit",
        "check-ref-format",
        "--allow-onelevel",
        "commit",
      ],
      { cwd },
    );
    assertEquals(result.success, true);
    assertEquals(result.code, 0);
  });
});

Deno.test("git aliases cannot smuggle commit through the generic runner", async () => {
  await withTempDir(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/seed.txt`, "seed\n");
    await gitInit(cwd);
    await git(cwd, "config", "alias.ship", "commit");
    const before = await gitOut(cwd, "rev-parse", "HEAD");

    const configured = await runGit(
      ["ship", "--allow-empty", "-m", "Bypass"],
      { cwd },
    );
    assertEquals(configured.success, false);
    assertEquals(await gitOut(cwd, "rev-parse", "HEAD"), before);

    const inline = await runGit(
      ["-c", "alias.ship=commit", "ship", "--allow-empty", "-m", "Bypass"],
      { cwd },
    );
    assertEquals(inline.success, false);
    assertEquals(inline.code, 2);
    assertEquals(inline.stderr, GIT_ALIAS_BOUNDARY_ERROR);
    assertEquals(await gitOut(cwd, "rev-parse", "HEAD"), before);
  });
});

Deno.test("discern commit messages use an injectable non-empty opt-out", () => {
  const attributed = discernCommitMessage("Subject", "Body", fakeEnv());
  assertEquals(
    attributed,
    `Subject\n\nBody\n\n${DISCERN_BOT.trailer}`,
  );
  assertEquals(
    discernCommitMessage(
      "Subject",
      "Body",
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    ),
    "Subject\n\nBody",
  );
  assertEquals(
    discernCommitMessage(
      "Subject",
      undefined,
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "" }),
    ),
    `Subject\n\n${DISCERN_BOT.trailer}`,
  );
});
