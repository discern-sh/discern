import { assertEquals } from "@std/assert";
import { integrationBranch } from "../src/engine/worktree/git.ts";
import { scriptEnvVars } from "../src/shared/env.ts";
import { fakeEnv } from "./helpers.ts";

Deno.test("the integration-branch override is namespaced and ignores MAIN_BRANCH", () => {
  assertEquals(
    integrationBranch(
      "configured",
      fakeEnv({ MAIN_BRANCH: "stray-ci-value" }),
    ),
    "configured",
  );
  assertEquals(
    integrationBranch(
      "configured",
      fakeEnv({
        MAIN_BRANCH: "stray-ci-value",
        DISCERN_MAIN_BRANCH: "explicit-override",
      }),
    ),
    "explicit-override",
  );
});

Deno.test("Project scripts receive DISCERN_MAIN_BRANCH and no unnamespaced alias", () => {
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
      DISCERN_MAIN_BRANCH: "trunk",
    },
  );
});
