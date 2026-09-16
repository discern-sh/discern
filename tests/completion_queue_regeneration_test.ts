import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { commitUpdateRegeneration } from "../src/engine/worktree/git.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES as sites,
  type DiscernCommitMessageSelection,
  rollbackDiscernOwnedCommit,
} from "../src/shared/discern_commit.ts";

// The registry enrolls every future site; this table supplies only its typed message values.
const selections = {
  scaffoldWiring: { site: sites.scaffoldWiring, values: undefined },
  setupCompletion: { site: sites.setupCompletion, values: undefined },
  standardsPin: { site: sites.standardsPin, values: { pins: [] } },
  standardsLimitProposal: {
    site: sites.standardsLimitProposal,
    values: {
      proposals: [{
        standard: "bytes",
        direction: "down",
        trunkLimit: 1,
        proposedLimit: 2,
        measurement: 2,
        reason: "A required generated artifact increases the measured bytes.",
        evidencePaths: ["generated.txt"],
      }],
    },
  },
  updateRegeneration: { site: sites.updateRegeneration, values: undefined },
} satisfies {
  [Key in keyof typeof sites]: Extract<DiscernCommitMessageSelection, {
    site: typeof sites[Key];
  }>;
};

Deno.test("queue A03: only proven regeneration may commit detached, and rollback retains its environment", async () => {
  for (const selection of Object.values(selections)) {
    for (const source of ["staged-index", "worktree-pathspecs"] as const) {
      await withTempDir(async (root) => {
        await Deno.writeTextFile(join(root, "generated.txt"), "base\n");
        await gitInit(root);
        const author = await gitOut(root, "symbolic-ref", "HEAD");
        const base = await gitOut(root, "rev-parse", "HEAD");
        await git(root, "checkout", "--detach", base);
        await Deno.writeTextFile(join(root, "generated.txt"), "regenerated\n");
        await git(root, "add", "generated.txt");
        const common = {
          ...selection,
          cwd: root,
          pathspecs: ["generated.txt"],
        };
        const result = await commitDiscernChanges(
          source === "staged-index"
            ? {
              ...common,
              source,
              stagedProof: {
                branch: "",
                head: base,
                tree: await gitOut(root, "write-tree"),
              },
            }
            : { ...common, source },
        );
        const permitted = selection.site === sites.updateRegeneration &&
          source === "staged-index";
        assertEquals(result.success, permitted, result.stderr);
        assertEquals(await gitOut(root, "rev-parse", author), base);
        assertEquals(
          await gitOut(root, "show", ":generated.txt"),
          "regenerated",
        );
        if (permitted) {
          assert(result.owned !== undefined);
          assertEquals(
            (await rollbackDiscernOwnedCommit(result.owned)).kind,
            "retained",
          );
          assertEquals(
            await gitOut(root, "rev-parse", "HEAD"),
            result.owned.head,
          );
        } else {
          assertEquals(await gitOut(root, "rev-parse", "HEAD"), base);
          assertEquals(result.owned, undefined);
        }
      });
    }
  }
});

const hooks = {
  unchanged: null,
  expanded: {
    name: "pre-commit",
    body:
      "printf 'staged user bytes\\n' > hook-user.txt\ngit add -- hook-user.txt\nprintf 'later working bytes\\n' > hook-user.txt\n",
  },
  advanced: {
    name: "post-commit",
    body:
      "git -c core.hooksPath=/dev/null commit --allow-empty -m 'Intervening commit'\n",
  },
  attached: {
    name: "post-commit",
    body: "git switch -c hook-owned\n",
  },
};

for (const [name, hook] of Object.entries(hooks)) {
  Deno.test(
    "queue A03: detached regeneration preserves exact commit ownership: " +
      name,
    async () => {
      await withTempDir(async (root) => {
        await Deno.writeTextFile(join(root, "generated.txt"), "base\n");
        await gitInit(root);
        const author = await gitOut(root, "symbolic-ref", "HEAD");
        const base = await gitOut(root, "rev-parse", "HEAD");
        await git(root, "checkout", "--detach", base);
        await Deno.writeTextFile(join(root, "generated.txt"), "regenerated\n");
        if (hook !== null) {
          const path = join(root, ".git", "hooks", hook.name);
          await Deno.writeTextFile(path, "#!/bin/sh\nset -eu\n" + hook.body);
          await Deno.chmod(path, 0o755);
        }
        const result = await commitUpdateRegeneration(root, ["generated.txt"]);
        const head = await gitOut(root, "rev-parse", "HEAD");
        assert(head !== base, result.stderr);
        assertEquals(await gitOut(root, "rev-parse", author), base);
        assertEquals(
          await gitOut(root, "show", "HEAD:generated.txt"),
          "regenerated",
        );
        assertEquals(result.success, hook === null, result.stderr);
        assertEquals(
          await gitOut(root, "branch", "--show-current"),
          name === "attached" ? "hook-owned" : "",
        );
        if (name === "advanced") {
          assertEquals(await gitOut(root, "rev-parse", "HEAD~2"), base);
          assertEquals(
            await gitOut(root, "rev-parse", "HEAD^{tree}"),
            await gitOut(root, "rev-parse", "HEAD^1^{tree}"),
          );
        } else {
          assertEquals(await gitOut(root, "rev-parse", "HEAD^"), base);
        }
        if (name === "expanded") {
          assertEquals(
            await gitOut(root, "show", "HEAD:hook-user.txt"),
            "staged user bytes",
          );
          assertEquals(
            await gitOut(root, "show", ":hook-user.txt"),
            "staged user bytes",
          );
          assertEquals(
            await Deno.readTextFile(join(root, "hook-user.txt")),
            "later working bytes\n",
          );
        }
      });
    },
  );
}
