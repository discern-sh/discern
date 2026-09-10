import {
  addWorktree,
  git,
  gitInit,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
/** A configured authored effort with one shared producer and explicit required contexts. */
export async function project(
  root: string,
  contexts: readonly string[],
  extra = "",
  testRun = "printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'",
  testInputs: readonly string[] = ["**"],
  options: {
    concurrency?: number;
    lookahead?: number;
    environment?: readonly string[];
  } = {},
): Promise<string> {
  await scaffoldEngine(root, { agents: [] });
  await writeConfig(
    root,
    `[project]
slug = 'sample'
agents = []
logbook = false
[completion]
${
      options.concurrency === undefined
        ? ""
        : `concurrency = ${options.concurrency}`
    }
${options.lookahead === undefined ? "" : `lookahead = ${options.lookahead}`}
required_contexts = ${JSON.stringify(contexts)}
[jobs]
test = { run = ${JSON.stringify(testRun)}, inputs = ${
      JSON.stringify(testInputs)
    }${
      options.environment === undefined
        ? ""
        : `, environment = ${JSON.stringify(options.environment)}`
    } }
[standards.coverage]
producer = 'jobs.test'
direction = 'up'
limit = 90
${extra}`,
  );
  await Deno.writeTextFile(
    `${root}/.gitignore`,
    (await Deno.readTextFile(`${root}/.gitignore`)) + "\nexecutions\n",
  );
  await gitInit(root);
  const path = await addWorktree(root, "public-done");
  await Deno.writeTextFile(`${path}/source`, "authored\n");
  await git(path, "add", "source");
  await git(path, "commit", "-m", "Author source");
  return await Deno.realPath(path);
}
