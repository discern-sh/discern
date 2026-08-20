/**
 * Black-box authored-change checkpoint coverage. The governing merge-base's
 * generated model must narrow every structural calculation before thresholds,
 * conditions, previews, `when`, strict serving, persisted subjects, and Proof.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { CheckpointsOutputSchema } from "../src/shared/result_schemas.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";

interface CheckpointsEnvelope {
  data: {
    checkpoints: {
      id: string;
      preview?: {
        holds: boolean;
        when_pending?: boolean;
        matched?: string[];
        related?: {
          kind: "similar_existing";
          for_path: string;
          path: string;
        }[];
        vetoed_by?: string;
      };
      open_question?: {
        state: string;
        matched: string[];
        related?: {
          kind: "similar_existing";
          for_path: string;
          path: string;
        }[];
      };
    }[];
  };
}

interface DoneEnvelope {
  error?: string;
  data: {
    checkpoints?: {
      outstanding?: ServedCheckpoint[];
      declared_met?: Conclusion[];
    };
  };
}

interface ServedCheckpoint {
  id: string;
  mode: "stop" | "advise";
  question: string;
  matched: string[];
  related?: RelatedEvidence[];
}

interface Conclusion {
  id: string;
  matched?: string[];
  related?: RelatedEvidence[];
}

interface RelatedEvidence {
  kind: "similar_existing";
  for_path: string;
  path: string;
}

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Parse and validate one checkpoint-report envelope from CLI JSON. */
function parseCheckpoints(stdout: string): CheckpointsEnvelope {
  const envelope: unknown = JSON.parse(stdout.trim());
  CheckpointsOutputSchema.parse(envelope);
  return envelope as CheckpointsEnvelope;
}

/** Parse one Gate completion envelope from CLI JSON. */
function parseDone(stdout: string): DoneEnvelope {
  return JSON.parse(stdout.trim()) as DoneEnvelope;
}

/** Find one required checkpoint report row by id. */
function row(
  envelope: CheckpointsEnvelope,
  id: string,
): CheckpointsEnvelope["data"]["checkpoints"][number] {
  const found = envelope.data.checkpoints.find((entry) => entry.id === id);
  assert(found !== undefined, `missing checkpoint ${id}`);
  return found;
}

/** Read the current worktree's persisted Gate Proof marker. */
async function proofMarker(wt: string): Promise<string> {
  const path = await gitAdminStatePath(wt, "gateProof");
  assert(path !== undefined);
  return await Deno.readTextFile(path);
}

Deno.test("checkpoint previews calculate authored change from the governing generated model", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const config = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[generated.outputs]
paths = ["generated/**", "authored/widget.ts"]
run = "sh generate.sh"

[generated.map-export]
paths = ["project/map/generated/**"]
run = "sh generate.sh"

[checkpoints.generated-only]
paths = ["generated/**", "project/map/generated/**"]
include_generated = false
question = "Generated-only change stays quiet."

[checkpoints.threshold]
paths = ["authored/**", "generated/**", "project/map/generated/**"]
min_changed_files = 5
question = "A broad authored change is reviewed."

[checkpoints.excluded-only]
paths = ["authored/**"]
exclude_paths = ["authored/**"]
question = "Explicitly excluded change stays quiet."

[checkpoints.unless-generated]
paths = ["authored/**"]
unless_changed = ["generated/**", "project/map/generated/**"]
mode = "advise"
question = "Generated counterparts cannot veto authored change."

[checkpoints.deletions]
paths = ["authored/**", "generated/**"]
deletion_dominant = true
question = "A deletion-heavy authored cut is reviewed."

[checkpoints.similarity]
paths = ["authored/**"]
similar_new_file = true
question = "A parallel authored sibling is reviewed."

[checkpoints.authored-when]
paths = ["authored/**", "generated/**"]
exclude_paths = ["authored/delete.txt", "authored/widget2.ts"]
when = "sh select-authored.sh"
question = "Only admitted authored evidence reaches judgment."
`;
    await writeConfig(dir, config);
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(join(dir, "generate.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "select-authored.sh"),
      "#!/usr/bin/env sh\necho 'DISCERN_MATCH authored/new.txt'\necho 'DISCERN_MATCH generated/out.txt'\necho 'DISCERN_MATCH authored/widget2.ts'\nexit 0\n",
    );
    await Deno.mkdir(join(dir, "authored"), { recursive: true });
    await Deno.mkdir(join(dir, "generated"), { recursive: true });
    await Deno.writeTextFile(join(dir, "authored", "delete.txt"), "one\n");
    await Deno.writeTextFile(join(dir, "authored", "widget.ts"), "base\n");
    await Deno.writeTextFile(
      join(dir, "generated", "delete.txt"),
      Array.from({ length: 80 }, (_, index) => `line ${index}\n`).join(""),
    );
    await gitInit(dir);

    const wt = await addWorktree(dir, "authored-change");
    await Deno.remove(join(wt, "authored", "delete.txt"));
    await Deno.remove(join(wt, "generated", "delete.txt"));
    await Deno.writeTextFile(join(wt, "authored", "new.txt"), "new\n");
    await Deno.writeTextFile(join(wt, "authored", "widget2.ts"), "copy\n");
    await Deno.writeTextFile(join(wt, "generated", "out.txt"), "built\n");
    await Deno.mkdir(join(wt, "project", "map", "generated"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(wt, "project", "map", "generated", "index.md"),
      "generated map\n",
    );

    // The branch tries to enroll generated output and remove an exclusion.
    // The merge-base's policy and generated model must still govern.
    await writeConfig(
      wt,
      config
        .replace("include_generated = false", "include_generated = true")
        .replace('exclude_paths = ["authored/**"]', "exclude_paths = []"),
    );

    const result = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(result.code, 0, result.output);
    const envelope = parseCheckpoints(result.stdout);
    assertEquals(row(envelope, "generated-only").preview, {
      holds: false,
      vetoed_by: "generated_only",
    });
    assertEquals(row(envelope, "threshold").preview, {
      holds: false,
      vetoed_by: "min_changed_files",
    });
    assertEquals(row(envelope, "excluded-only").preview, {
      holds: false,
      vetoed_by: "excluded_only",
    });
    assertEquals(row(envelope, "deletions").preview, {
      holds: false,
      vetoed_by: "deletion_dominant",
    });
    assertEquals(row(envelope, "similarity").preview, {
      holds: false,
      vetoed_by: "similar_new_file",
    });
    assertEquals(row(envelope, "unless-generated").preview, {
      holds: true,
      matched: [
        "authored/delete.txt",
        "authored/new.txt",
        "authored/widget2.ts",
      ],
    });
    assertEquals(row(envelope, "authored-when").preview, {
      holds: true,
      when_pending: true,
      matched: ["authored/new.txt"],
    });

    // The first read covered unstaged deletions and untracked generated files.
    // Commit that same state so strict serving and Proof can bind it exactly.
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "exercise authored checkpoint evidence",
      "--no-gpg-sign",
    );
    const refused = await runAgent(wt, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const outstanding = parseDone(refused.stdout).data.checkpoints
      ?.outstanding;
    assertEquals(outstanding?.map((entry) => entry.id), ["authored-when"]);
    assertEquals(outstanding?.[0]?.matched, ["authored/new.txt"]);

    const met = await runAgent(wt, [
      "done",
      "--met",
      "authored-when",
      "--json",
    ]);
    assertEquals(met.code, 0, met.output);
    assertEquals(
      parseDone(met.stdout).data.checkpoints?.declared_met?.[0]?.matched,
      ["authored/new.txt"],
    );
    const proof = await proofMarker(wt);
    assertStringIncludes(proof, '"matched":["authored/new.txt"]');
    assertStringIncludes(proof, "Changed: `authored/new.txt`");
    assert(
      !proof.includes("generated/out.txt"),
      "default-excluded generated evidence escaped into Proof",
    );
  });
});

Deno.test("include_generated crosses preview, when narrowing, strict serving, and Proof", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[generated.outputs]
paths = ["api/generated/**"]
run = "sh generate.sh"

[checkpoints.generated-api]
paths = ["api/**"]
include_generated = true
when = "sh select.sh"
question = "The generated API result has been judged."
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(join(dir, "generate.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "select.sh"),
      "#!/usr/bin/env sh\necho 'DISCERN_MATCH api/generated/output.txt'\nexit 0\n",
    );
    await gitInit(dir);

    const wt = await addWorktree(dir, "included-generated");
    await Deno.mkdir(join(wt, "api", "generated"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "authored\n");
    await Deno.writeTextFile(
      join(wt, "api", "generated", "output.txt"),
      "generated\n",
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "add generated api",
      "--no-gpg-sign",
    );

    const preview = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(row(preview, "generated-api").preview, {
      holds: true,
      when_pending: true,
      matched: ["api/generated/output.txt", "api/surface.txt"],
    });

    const refused = await runAgent(wt, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const refusedEnvelope = parseDone(refused.stdout);
    assertEquals(refusedEnvelope.error, AWAITING_DECLARATION_SLUG);
    assertEquals(refusedEnvelope.data.checkpoints?.outstanding?.[0], {
      id: "generated-api",
      mode: "stop",
      question: "The generated API result has been judged.",
      matched: ["api/generated/output.txt"],
    });

    const completed = await runAgent(wt, [
      "done",
      "--met",
      "generated-api",
      "--json",
    ]);
    assertEquals(completed.code, 0, completed.output);
    const completedEnvelope = parseDone(completed.stdout);
    assertEquals(
      completedEnvelope.data.checkpoints?.declared_met?.[0]?.matched,
      ["api/generated/output.txt"],
    );
    const proof = await proofMarker(wt);
    assertStringIncludes(proof, '"matched":["api/generated/output.txt"]');
    assertStringIncludes(proof, "Changed: `api/generated/output.txt`");
  });
});

Deno.test("similar siblings remain typed Proof evidence and reopen on change or removal", async () => {
  await withTempDir(async (dir) => {
    const existing = "api/weird`name.ts";
    const added = "api/weird`name2.ts";
    const related: RelatedEvidence[] = [{
      kind: "similar_existing",
      for_path: added,
      path: existing,
    }];
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.parallel]
paths = ["api/**"]
similar_new_file = true
question = "The parallel sibling is necessary."
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await Deno.mkdir(join(dir, "api"), { recursive: true });
    await Deno.writeTextFile(join(dir, existing), "base\n");
    await gitInit(dir);

    const wt = await addWorktree(dir, "related-sibling");
    await Deno.writeTextFile(join(wt, added), "parallel\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "add sibling", "--no-gpg-sign");

    const preview = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(row(preview, "parallel").preview, {
      holds: true,
      matched: [added],
      related,
    });
    const status = await runAgent(wt, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const statusHints =
      (JSON.parse(status.stdout.trim()) as { hints?: string[] })
        .hints ?? [];
    assertStringIncludes(
      statusHints.join("\n"),
      "Related existing: ``api/weird`name.ts`` resembles ``api/weird`name2.ts``",
    );

    const refused = await runAgent(wt, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    assertEquals(
      parseDone(refused.stdout).data.checkpoints?.outstanding?.[0]?.related,
      related,
    );
    const markdown = await runAgent(wt, ["done", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertStringIncludes(
      markdown.stdout,
      "Related existing: ``api/weird`name.ts`` resembles ``api/weird`name2.ts``",
    );

    const met = await runAgent(wt, ["done", "--met", "parallel", "--json"]);
    assertEquals(met.code, 0, met.output);
    assertEquals(
      parseDone(met.stdout).data.checkpoints?.declared_met?.[0]?.related,
      related,
    );
    const proof = await proofMarker(wt);
    assertStringIncludes(
      proof,
      '"related":[{"kind":"similar_existing","for_path":"api/weird`name2.ts","path":"api/weird`name.ts"}]',
    );
    assertStringIncludes(
      proof,
      "Related existing: `` api/weird`name.ts `` resembles `` api/weird`name2.ts ``",
    );

    await Deno.writeTextFile(join(wt, existing), "changed\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "change sibling", "--no-gpg-sign");
    const changed = await runAgent(wt, ["done", "--json"]);
    assertEquals(changed.code, 1, changed.output);
    assertEquals(parseDone(changed.stdout).error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      parseDone(changed.stdout).data.checkpoints?.outstanding?.[0]?.related,
      related,
    );
    assertEquals(
      (await runAgent(wt, ["done", "--met", "parallel", "--json"])).code,
      0,
    );

    await Deno.remove(join(wt, existing));
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "remove sibling", "--no-gpg-sign");
    const removed = await runAgent(wt, ["done", "--json"]);
    assertEquals(removed.code, 1, removed.output);
    const removedEnvelope = parseDone(removed.stdout);
    assertEquals(removedEnvelope.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      removedEnvelope.data.checkpoints?.outstanding?.[0]?.related,
      related,
    );
  });
});
