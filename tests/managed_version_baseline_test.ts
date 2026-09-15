/** Execute frozen production code, never the current parser with an older label. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { renderConfigSchemaJson } from "../src/shared/config_codegen.ts";
import { decodeWith } from "./decode_cli_result.ts";

const fixture = fromFileUrl(
  new URL("./fixtures/managed-version-baseline/", import.meta.url),
);
const Manifest = z.object({
  version: z.string(),
  schema: z.number(),
  unpacked_reader_sha256: z.string(),
  files: z.record(z.string(), z.string()),
});
const Reader = z.object({
  error: z.string().optional(),
  running: z.string().optional(),
  comparison: z.object({ state: z.string() }).optional(),
  boundary: z.string().optional(),
  gate: z.object({ title: z.string(), steps: z.array(z.unknown()) }).optional(),
  currency: z.object({
    state: z.string(),
    drift: z.array(z.object({ path: z.string(), reason: z.string() }))
      .optional(),
  }).optional(),
});

/** SHA-256 for the pinned archive, unpacked executable, and template inputs. */
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((
    byte,
  ) => byte.toString(16).padStart(2, "0")).join("");
}

/** Invoke the frozen executable with its frozen instruction template root. */
async function readFrozen(root: string): Promise<z.infer<typeof Reader>> {
  return await withTempDir(async (runtime) => {
    const source = await Deno.readFile(join(fixture, "reader.js.gz"));
    const unpacked = new Blob([source]).stream().pipeThrough(
      new DecompressionStream("gzip"),
    );
    const executable = join(runtime, "reader.js");
    await Deno.writeFile(
      executable,
      new Uint8Array(await new Response(unpacked).arrayBuffer()),
    );
    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-config",
        "--no-lock",
        "--allow-read",
        "--allow-env",
        "--allow-run=git",
        "--ext=js",
        executable,
        root,
      ],
      env: { DISCERN_TEMPLATES_DIR: join(fixture, "templates") },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(run.success, new TextDecoder().decode(run.stderr));
    return decodeWith(Reader, new TextDecoder().decode(run.stdout));
  });
}

Deno.test("first-public adoption reader and template are immutable compatibility inputs", async () => {
  const manifest = decodeWith(
    Manifest,
    await Deno.readTextFile(join(fixture, "manifest.json")),
  );
  for (const [path, expected] of Object.entries(manifest.files)) {
    const actual = await digest(await Deno.readFile(join(fixture, path)));
    assertEquals(actual, expected, `frozen input changed: ${path}`);
  }
  const packed = await Deno.readFile(join(fixture, "reader.js.gz"));
  const unpacked = new Blob([packed]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  assertEquals(
    await digest(new Uint8Array(await new Response(unpacked).arrayBuffer())),
    manifest.unpacked_reader_sha256,
  );
  // Release guard: the recognized optional key must survive in the public reader.
  assertEquals(configSchema.parse({}).meta.managed_version, undefined);
  assertStringIncludes(renderConfigSchemaJson(), '"managed_version"');
  assert(
    !(await Deno.readTextFile(join(fixture, "discern.toml.tmpl"))).includes(
      "managed_version =",
    ),
  );
});

Deno.test("frozen reader recognizes future adoption, skips old-template comparison, and withholds Proof", async () => {
  await withTempDir(async (root) => {
    const configPath = join(root, "discern.toml");
    const config =
      '[meta]\nschema_version = 1\nbootstrapped = true\nmanaged_version = "2.0.0"\n[project]\nagents = ["codex"]\n';
    await Deno.writeTextFile(configPath, config);
    await Deno.writeTextFile(
      join(root, "AGENTS.md"),
      "# Material adopted by a newer release\n",
    );
    await gitInit(root);
    const ahead = await readFrozen(root);
    assertEquals(ahead.running, "1.0.0");
    assertEquals(ahead.comparison?.state, "project-managed-by-newer");
    assertStringIncludes(ahead.boundary ?? "", "discern releases");
    assertEquals(ahead.currency?.state, "unverified");
    assertEquals(ahead.gate?.steps, []);
    assertEquals(await Deno.readTextFile(configPath), config);

    await Deno.writeTextFile(configPath, config.replace('"2.0.0"', '"1.0.0"'));
    await git(root, "add", "-A");
    await git(root, "commit", "-m", "same-version drift fixture");
    const equal = await readFrozen(root);
    assertEquals(equal.comparison?.state, "equal");
    assertEquals(equal.currency?.state, "checked");
    assert(equal.currency?.drift?.some((entry) => entry.path === "AGENTS.md"));

    await Deno.writeTextFile(
      configPath,
      config.replace("schema_version = 1", "schema_version = 2"),
    );
    assertEquals((await readFrozen(root)).error, "schema_version_too_new");
    await Deno.writeTextFile(
      configPath,
      config.replace("managed_version", "installed_version"),
    );
    assertEquals((await readFrozen(root)).error, "invalid_config");
  });
});
