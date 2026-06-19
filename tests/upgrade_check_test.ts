/**
 * CLI tests for `icculus upgrade --check` — the read-only drift primitive that
 * backs Option C's `selfcheck` gate slot. It exits non-zero (and writes nothing)
 * when any *managed* file is out of sync with `templates/`: edited, missing, or
 * otherwise not provably the kit's. Human lines go to stderr, so the machine
 * assertions read `--json` from stdout.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, targetExists, withTempDir } from "./helpers.ts";

/** Fresh 1.0 install in `dir`. */
async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
    0,
  );
}

Deno.test("upgrade --check passes on a fresh, in-sync install", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.check, true);
    assertEquals(res.drifted, []);
  });
});

Deno.test("upgrade --check writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // A read-only check must not create the `.new` siblings an edit would.
    await Deno.writeTextFile(
      join(dir, "agent"),
      `${await Deno.readTextFile(join(dir, "agent"))}\n# probe\n`,
    );
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertEquals(
      await targetExists(dir, "agent.new"),
      false,
      "--check must not write a .new sibling",
    );
  });
});

Deno.test("upgrade --check reports an edited managed file by its canonical path", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const agent = join(dir, "agent");
    await Deno.writeTextFile(
      agent,
      `${await Deno.readTextFile(agent)}\n# local edit\n`,
    );
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    const paths = res.drifted.map((d: { path: string }) => d.path);
    // The canonical path, never `agent.new`.
    assertEquals(paths.includes("agent"), true);
    assertEquals(paths.includes("agent.new"), false);
    const op = res.drifted.find((d: { path: string }) => d.path === "agent");
    assertEquals(op.action, "new"); // edited managed file → preserved as .new
  });
});

Deno.test("upgrade --check reports a missing managed file as create-drift", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await Deno.remove(join(dir, ".icculus/engine/finish"));
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    const op = res.drifted.find((d: { path: string }) =>
      d.path === ".icculus/engine/finish"
    );
    assertEquals(op?.action, "create");
  });
});

Deno.test("upgrade --check (human mode) exits non-zero and names the drifted path on stderr", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const agent = join(dir, "agent");
    await Deno.writeTextFile(
      agent,
      `${await Deno.readTextFile(agent)}\n# local edit\n`,
    );
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "agent");
  });
});

Deno.test("upgrade --check heals with the product command, never engine-internal vocabulary", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const agent = join(dir, "agent");
    await Deno.writeTextFile(
      agent,
      `${await Deno.readTextFile(agent)}\n# local edit\n`,
    );
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 1, r.stderr);
    // A fresh install has only the `icculus` binary — the self-host Deno-task
    // aliases (`deno task selfsync`/`selfcheck`) must never leak into its output.
    assertStringIncludes(r.stderr, "icculus upgrade");
    assertEquals(r.stderr.includes("deno task"), false, r.stderr);
    assertEquals(r.stderr.includes("selfsync"), false, r.stderr);
  });
});

// ---- schema-version currency, the self-host canary (ADR 0014) -------------

/** Overwrite the install manifest's recorded schema_version. */
async function setSchemaVersion(dir: string, version: number): Promise<void> {
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.schema_version = version;
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("upgrade --check reports the install schema and passes when it is current", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.schema.recorded, res.schema.current);
  });
});

Deno.test("upgrade --check flags a stale schema as drift even when files are in sync", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Model an install left a schema behind (a migration shipped since).
    await setSchemaVersion(dir, 1);
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.schema.recorded, 1);
    assertEquals(res.schema.current, 4);
    assertEquals(res.drifted, []); // managed files themselves are fine
  });
});

Deno.test("upgrade --check (human mode) names a stale schema", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchemaVersion(dir, 0);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "schema");
  });
});

Deno.test("upgrade --check heals with `deno task selfsync` when the project drives upgrade via a Deno task", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Model the self-host repo: a deno.json that declares the selfsync alias.
    // The CLI subprocess anchors its own config to the entrypoint, so this
    // deno.json only feeds selfCmd's marker check — it does not shadow imports.
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      `${
        JSON.stringify(
          { tasks: { selfsync: "deno run -A src/main.ts upgrade" } },
          null,
          2,
        )
      }\n`,
    );
    const agent = join(dir, "agent");
    await Deno.writeTextFile(
      agent,
      `${await Deno.readTextFile(agent)}\n# local edit\n`,
    );
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "deno task selfsync");
  });
});
