import { assertEquals } from "@std/assert";
import { integrationBranch } from "../src/engine/worktree/git.ts";
import { scriptEnvVars } from "../src/shared/env.ts";
import { fakeEnv } from "./helpers.ts";

Deno.test("the trunk override is namespaced and ignores unnamespaced variables", () => {
  assertEquals(
    integrationBranch(
      "configured",
      fakeEnv({ MAIN_BRANCH: "stray-ci-value", TRUNK: "stray-ci-value" }),
    ),
    "configured",
  );
  assertEquals(
    integrationBranch(
      "configured",
      fakeEnv({
        MAIN_BRANCH: "stray-ci-value",
        TRUNK: "stray-ci-value",
        DISCERN_TRUNK: "explicit-override",
      }),
    ),
    "explicit-override",
  );
});

Deno.test("Project scripts receive DISCERN_TRUNK and no unnamespaced alias", () => {
  assertEquals(
    scriptEnvVars({
      root: "/project",
      tomlPath: "/project/discern.toml",
      scriptsDir: "scripts",
      scriptsAbs: "/project/scripts",
      mainBranch: "trunk",
    }),
    {
      DISCERN_ROOT: "/project",
      DISCERN_TOML: "/project/discern.toml",
      DISCERN_SCRIPTS: "/project/scripts",
      DISCERN_SCRIPTS_DIR: "scripts",
      DISCERN_TRUNK: "trunk",
    },
  );
});
