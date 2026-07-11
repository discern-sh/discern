import { assertEquals } from "@std/assert";
import { integrationBranch } from "../src/engine/worktree/git.ts";
import { recipeEnvVars } from "../src/shared/env.ts";
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

Deno.test("project recipes receive DISCERN_MAIN_BRANCH and no unnamespaced alias", () => {
  assertEquals(
    recipeEnvVars({
      root: "/project",
      tomlPath: "/project/discern.toml",
      recipesDir: "recipes",
      recipesAbs: "/project/recipes",
      mainBranch: "trunk",
    }),
    {
      DISCERN_ROOT: "/project",
      DISCERN_TOML: "/project/discern.toml",
      DISCERN_RECIPES: "/project/recipes",
      DISCERN_RECIPES_DIR: "recipes",
      DISCERN_MAIN_BRANCH: "trunk",
    },
  );
});
