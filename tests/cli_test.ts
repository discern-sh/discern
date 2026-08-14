/**
 * CLI-surface tests: run `src/main.ts` as a subprocess so Cliffy parsing, the
 * global flags, JSON output, and process exit codes are all exercised for real.
 * These complement the unit/plan tests, which call the command functions
 * directly.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { KIT_VERSION } from "../src/lib/version.ts";
import { runCli, withTempDir } from "./helpers.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";

/** True when a path exists on disk. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Assert a path does NOT exist on disk. */
async function assertNotExists(path: string): Promise<void> {
  assert(!(await pathExists(path)), `expected ${path} not to exist`);
}

Deno.test("--version prints the kit version", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["--version"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, KIT_VERSION);
  });
});

Deno.test("setup --json scaffolds and reports JSON", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      [
        "setup",
        "--confirmed",
        "--json",
        "--name",
        "CLI Demo",
        "--slug",
        "cli-demo",
      ],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "setup");
    assertEquals(result.data.project.slug, "cli-demo");
    assert(Array.isArray(result.data.written));
    // The whole machinery footprint is the single root config file (ADR 0020).
    assert(result.data.written.includes("discern.toml"));
    // setup compiles the agent files; `compiled` lists them.
    assert(Array.isArray(result.data.compiled));
    assert(result.data.compiled.includes("AGENTS.md"));
    assert(result.data.compiled.includes("CLAUDE.md"));
    // It also lays the doc skeletons; `skeletons` lists them, and it prints the
    // agent instructions inline.
    assert(result.data.skeletons.includes(SOURCE_PATHS.map.defaultPath));
    assert(typeof result.data.instructions === "string");
    // The files really landed.
    await Deno.stat(join(dir, "discern.toml"));
    await Deno.stat(join(dir, "AGENTS.md"));
    await Deno.stat(join(dir, "CLAUDE.md"));
    // The bundled skills are materialized into `.claude/skills/` (gitignored).
    await Deno.stat(join(dir, ".claude/skills"));
    // setup wires the discern MCP server for Claude Code (ADR 0031): `.mcp.json`
    // is written and reported under `mcp_wired`.
    assert(Array.isArray(result.data.mcp_wired));
    assert(
      result.data.mcp_wired.includes(".mcp.json"),
      JSON.stringify(result.data.mcp_wired),
    );
    const mcp = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    assertEquals(mcp.mcpServers.discern.command, "discern");
    // No committed shell engine: there is no root `agent` dispatcher.
    await assertNotExists(join(dir, "agent"));
  });
});

Deno.test("setup --dry-run --json writes nothing", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["setup", "--confirmed", "--dry-run", "--json", "--slug", "dry-demo"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.dry_run, true);
    assert(Array.isArray(result.data.plan));
    // Nothing was written.
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 0);
  });
});

Deno.test("setup re-run over a set-up install reports already_set_up (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--slug", "first"], dir);
    // Mark setup complete (--force: the laid skeletons still carry markers).
    await runCli(["setup", "done", "--force"], dir);
    // `begin` on a recorded install is idempotent — it reports already_set_up rather
    // than re-scaffolding (the welcome's `phase: done` is the parent's equivalent).
    const { code, stdout } = await runCli(["setup", "begin", "--json"], dir);
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    assertEquals(result.data.already_set_up, true);
  });
});

Deno.test("setup --force re-scaffolds an existing install without erroring", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--json", "--slug", "first"], dir);
    const { code, stdout } = await runCli(
      ["setup", "--confirmed", "--force", "--json", "--slug", "first"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    // The existing config seed is left as-is (a present seed is skipped), so it
    // is not in the written list.
    assert(!result.data.written.includes("discern.toml"));
    // The agent files are recompiled on every run, so `compiled` lists them.
    assert(result.data.compiled.includes("AGENTS.md"));
    assert(result.data.compiled.includes("CLAUDE.md"));
  });
});

Deno.test("setup --force leaves a pre-existing seed file untouched (no overwrite, no .new)", async () => {
  await withTempDir(async (dir) => {
    // A repo already carrying the config seed the kit would scaffold; the present
    // seed is left as the user's (skipped), not overwritten.
    const userBody = "# the user's own config — must survive setup\n";
    await Deno.writeTextFile(join(dir, "discern.toml"), userBody);

    const { code } = await runCli(
      ["setup", "--confirmed", "--force", "--json", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 0);
    // The user's file is byte-for-byte intact; no `.new` sibling is produced.
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      userBody,
    );
    await assertNotExists(join(dir, "discern.toml.new"));
  });
});

Deno.test("setup rejects an invalid --slug", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runCli(
      ["setup", "--confirmed", "--slug", "Bad Slug"],
      dir,
    );
    assert(code !== 0);
    assertStringIncludes(stderr, "invalid --slug");
  });
});

Deno.test("doctor --json reports invalid result when not initialized", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["doctor", "--json"], dir);
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    const toml = result.data.checks.find((c: { name: string }) =>
      c.name === "discern.toml"
    );
    assertEquals(toml.ok, false);
    assert(typeof toml.fix === "string" && toml.fix.length > 0);
  });
});

Deno.test("doctor reports the schema version is current on a fresh install", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["setup", "--confirmed", "--slug", "demo"], dir)).code,
      0,
    );
    const { stdout } = await runCli(["doctor", "--json"], dir);
    const result = JSON.parse(stdout);
    const schema = result.data.checks.find((c: { name: string }) =>
      c.name === "schema version"
    );
    assert(
      schema !== undefined && schema.ok === true,
      "schema should be current",
    );
  });
});

Deno.test("preset reports unknown preset with a friendly error", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--json", "--slug", "demo"], dir);
    const { code, stdout } = await runCli(
      ["preset", "node", "--json"],
      dir,
    );
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "unknown_preset");
  });
});

Deno.test("a malformed discern.toml fails cleanly (no stack trace), in human and JSON", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );
    // Human mode: a one-line diagnostic on stderr, exit 1, no raw "Uncaught".
    const human = await runCli(["config", "get", "project.slug"], dir);
    assertEquals(human.code, 1);
    assertStringIncludes(human.stderr, "syntax error near line");
    assertStringIncludes(human.stderr, "discern.toml");
    assert(
      !human.stderr.includes("Uncaught"),
      `must not dump a stack trace:\n${human.stderr}`,
    );
    // JSON mode: a structured error on stdout (a CI/agent consumer parses it).
    const json = await runCli(["done", "--json"], dir);
    assertEquals(json.code, 1);
    const result = JSON.parse(json.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_toml");
  });
});

// B33 — the class: EVERY help/informational path must render FULLY and exit 0
// on bad project state (a broken, missing, or schema-invalid discern.toml) —
// help is exactly when a user most needs it to keep working. Two sweeps below:
// the root --help/-h render in full detail, then every other informational
// member — each built-in verb's --help (driven off KNOWN_VERBS, so a new verb
// auto-enrols), --version, licenses, and the help verb.
const BAD_PROJECT_STATES: ReadonlyArray<{ name: string; toml: string | null }> =
  [
    { name: "missing discern.toml", toml: null },
    {
      name: "syntactically broken discern.toml",
      toml: 'this is = not valid toml [[[\n"unterminated\n',
    },
    {
      // Parses as TOML but violates the schema (an unknown standard direction),
      // so the TYPED loadConfig throws where the raw reader would not.
      name: "schema-invalid discern.toml",
      toml: [
        "[project]",
        'slug = "x"',
        "",
        "[standards.bad]",
        'run = "true"',
        "limit = 5",
        'direction = "sideways"',
        "",
      ].join("\n"),
    },
  ];

for (const state of BAD_PROJECT_STATES) {
  for (const flag of ["--help", "-h"]) {
    Deno.test(`\`discern ${flag}\` renders fully and exits 0 with a ${state.name}`, async () => {
      await withTempDir(async (dir) => {
        if (state.toml !== null) {
          await Deno.writeTextFile(join(dir, "discern.toml"), state.toml);
        }
        const r = await runCli([flag], dir);
        // Exit 0 even when the surrounding project state is unreadable.
        assertEquals(
          r.code,
          0,
          `${flag} must exit 0 on a ${state.name}:\n${r.stdout}\n${r.stderr}`,
        );
        const out = r.stdout + r.stderr;
        // The help rendered in full — the grouped command list AND the trailing
        // drill-in footer both present (a truncated help would be missing the
        // footer at the end of the generated help).
        assertStringIncludes(out, "Commands:");
        assertStringIncludes(out, "AGENTIC LOOP");
        assertStringIncludes(out, "discern <command> --help");
        // No raw crash leaked into the help.
        assert(
          !out.includes("Uncaught"),
          `help must not dump a stack trace:\n${out}`,
        );
      });
    });
  }
}

/** One informational path: its argv and the markers a full render carries. */
interface InformationalPath {
  label: string;
  args: string[];
  markers: string[];
}

/** Every informational path beyond the root --help/-h: the member axis is
 * KNOWN_VERBS (the routing SSOT), so a new verb enrols without a test edit. */
function informationalPaths(): InformationalPath[] {
  return [
    { label: "--version", args: ["--version"], markers: [KIT_VERSION] },
    {
      label: "licenses",
      args: ["licenses"],
      markers: ["Third-Party Software Notices"],
    },
    {
      label: "help",
      args: ["help"],
      markers: ["Commands:", "discern <command> --help"],
    },
    ...[...KNOWN_VERBS].sort().map((verb) => ({
      label: `${verb} --help`,
      args: [verb, "--help"],
      markers: ["Usage:", verb, "--help"],
    })),
  ];
}

for (const state of BAD_PROJECT_STATES) {
  Deno.test(`every informational path renders and exits 0 with a ${state.name}`, async () => {
    await withTempDir(async (dir) => {
      if (state.toml !== null) {
        await Deno.writeTextFile(join(dir, "discern.toml"), state.toml);
      }
      const queue = informationalPaths();
      const failures: string[] = [];
      const drain = async (): Promise<void> => {
        for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
          const r = await runCli(m.args, dir);
          const out = r.stdout + r.stderr;
          if (r.code !== 0) {
            failures.push(`${m.label}: exit ${r.code}\n${out}`);
          } else if (out.includes("Uncaught")) {
            failures.push(`${m.label}: dumped a stack trace:\n${out}`);
          } else {
            for (const marker of m.markers) {
              if (!out.includes(marker)) {
                failures.push(`${m.label}: rendered without "${marker}"`);
              }
            }
          }
        }
      };
      // A narrow pool: the full suite runs many files in parallel, and a wide
      // subprocess fan-out here starves its timing-sensitive neighbours.
      await Promise.all(Array.from({ length: 3 }, drain));
      assertEquals(
        failures,
        [],
        `informational paths must survive a ${state.name}:\n${
          failures.join("\n")
        }`,
      );
    });
  });
}
