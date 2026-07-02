/**
 * Create a disposable, domain-generic repository for clean-room `discern setup`
 * evaluations.
 *
 * The fixture intentionally contains no discern files. It is a tiny working app,
 * committed on `main`, so setup exercises the fresh-install path in a real git repo.
 */

import { dirname, join, resolve } from "@std/path";

type Flavor = "deno" | "node";

interface Options {
  flavor: Flavor;
  targetDir: string | undefined;
  withDocs: boolean;
  json: boolean;
  help: boolean;
}

interface FixtureResult {
  branch: string;
  docs: string | null;
  flavor: Flavor;
  path: string;
}

const DECODER = new TextDecoder();

const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

function usage(): string {
  return `Usage:
  deno run --allow-read --allow-write --allow-env --allow-run scripts/setup-eval/make-fixture.ts [options]

Options:
  --flavor <deno|node>   Fixture stack to create (default: deno)
  --flavour <deno|node>  Alias for --flavor
  --dir <path>           Create the fixture in this empty directory instead of a temp dir
  --with-docs            Include an existing docs/ tree (default)
  --no-docs              Omit docs/
  --json                 Print machine-readable output
  -h, --help             Show this help
`;
}

function valueAfter(
  args: readonly string[],
  index: number,
  flag: string,
): { next: number; value: string } {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return { next: index + 1, value };
}

function parseFlavor(value: string): Flavor {
  if (value === "deno" || value === "node") {
    return value;
  }
  throw new Error(`unknown fixture flavor "${value}"`);
}

function parseArgs(args: readonly string[]): Options {
  let flavor: Flavor = "deno";
  let targetDir: string | undefined;
  let withDocs = true;
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--flavor" || arg === "--flavour") {
      const parsed = valueAfter(args, index, arg);
      flavor = parseFlavor(parsed.value);
      index = parsed.next;
    } else if (arg === "--dir") {
      const parsed = valueAfter(args, index, arg);
      targetDir = parsed.value;
      index = parsed.next;
    } else if (arg === "--with-docs") {
      withDocs = true;
    } else if (arg === "--no-docs") {
      withDocs = false;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }

  return { flavor, targetDir, withDocs, json, help };
}

async function assertEmptyDir(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  for await (const entry of Deno.readDir(path)) {
    throw new Error(
      `target directory is not empty (${entry.name} already exists): ${path}`,
    );
  }
}

async function writeText(
  root: string,
  rel: string,
  text: string,
): Promise<void> {
  const path = join(root, rel);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, text);
}

async function runGit(root: string, args: string[]): Promise<void> {
  const command = new Deno.Command("git", {
    args,
    cwd: root,
    env: GIT_ENV,
    stdout: "null",
    stderr: "piped",
  });
  const { success, stderr } = await command.output();
  if (!success) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${DECODER.decode(stderr)}`,
    );
  }
}

async function gitInit(root: string): Promise<void> {
  await runGit(root, ["init", "-q"]);
  await runGit(root, ["config", "user.email", "setup-eval@example.com"]);
  await runGit(root, ["config", "user.name", "Setup Eval"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["add", "-A"]);
  await runGit(root, ["commit", "-q", "-m", "Create setup eval fixture"]);
  await runGit(root, ["branch", "-M", "main"]);
}

async function writeCommonFiles(
  root: string,
  flavor: Flavor,
  withDocs: boolean,
): Promise<void> {
  await writeText(
    root,
    "README.md",
    `# Setup Eval Fixture

This is a small, disposable project for evaluating a first-time \`discern setup\` run.
It intentionally starts with no discern files.

Stack: ${flavor}
`,
  );

  if (withDocs) {
    await writeText(
      root,
      "docs/README.md",
      `# Project Notes

This existing docs tree represents human-written project notes. The setup eval
checks whether the agent keeps it separate from discern's agent documentation.
`,
    );
  }
}

async function writeDenoFixture(root: string): Promise<void> {
  await writeText(
    root,
    "deno.json",
    `{
  "tasks": {
    "check": "deno check src/main.ts",
    "test": "deno test",
    "fmt": "deno fmt --check",
    "lint": "deno lint"
  }
}
`,
  );
  await writeText(
    root,
    "src/main.ts",
    `export interface Item {
  done: boolean;
  id: string;
  title: string;
}

export function summarize(items: readonly Item[]): string {
  const open = items.filter((item) => !item.done).length;
  return \`\${open} open / \${items.length} total\`;
}

if (import.meta.main) {
  console.log(summarize([
    { done: false, id: "one", title: "Review setup" },
    { done: true, id: "two", title: "Commit baseline" },
  ]));
}
`,
  );
  await writeText(
    root,
    "src/main_test.ts",
    `import { summarize } from "./main.ts";

Deno.test("summarize counts open items", () => {
  const actual = summarize([
    { done: false, id: "one", title: "A" },
    { done: true, id: "two", title: "B" },
  ]);
  if (actual !== "1 open / 2 total") {
    throw new Error(\`expected one open item, got \${actual}\`);
  }
});
`,
  );
}

async function writeNodeFixture(root: string): Promise<void> {
  await writeText(
    root,
    "package.json",
    `{
  "name": "setup-eval-fixture",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "node --check src/index.js",
    "test": "node --test"
  }
}
`,
  );
  await writeText(
    root,
    "src/index.js",
    `export function summarize(items) {
  const open = items.filter((item) => !item.done).length;
  return \`\${open} open / \${items.length} total\`;
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  console.log(summarize([
    { done: false, id: "one", title: "Review setup" },
    { done: true, id: "two", title: "Commit baseline" },
  ]));
}
`,
  );
  await writeText(
    root,
    "test/index.test.js",
    `import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../src/index.js";

test("summarize counts open items", () => {
  assert.equal(
    summarize([
      { done: false, id: "one", title: "A" },
      { done: true, id: "two", title: "B" },
    ]),
    "1 open / 2 total",
  );
});
`,
  );
}

async function createFixture(opts: Options): Promise<FixtureResult> {
  const root = opts.targetDir === undefined
    ? await Deno.makeTempDir({ prefix: `discern-setup-eval-${opts.flavor}-` })
    : resolve(opts.targetDir);

  if (opts.targetDir !== undefined) {
    await assertEmptyDir(root);
  }

  await writeCommonFiles(root, opts.flavor, opts.withDocs);
  if (opts.flavor === "deno") {
    await writeDenoFixture(root);
  } else {
    await writeNodeFixture(root);
  }
  await gitInit(root);

  return {
    branch: "main",
    docs: opts.withDocs ? "docs/" : null,
    flavor: opts.flavor,
    path: root,
  };
}

function printHuman(result: FixtureResult): void {
  const check = result.flavor === "deno" ? "deno task test" : "npm test";
  console.log(`Created ${result.flavor} setup-eval fixture:
  ${result.path}

Initial branch:
  ${result.branch}

Existing docs tree:
  ${result.docs ?? "(none)"}

Sanity check:
  cd ${result.path}
  ${check}
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(Deno.args);
  if (opts.help) {
    console.log(usage());
    return;
  }

  const result = await createFixture(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    Deno.exit(1);
  }
}
