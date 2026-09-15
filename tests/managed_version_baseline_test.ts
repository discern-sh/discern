/** Execute frozen production code, never the current parser with an older label. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { renderConfigSchemaJson } from "../src/shared/config_codegen.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { parseVersion } from "../src/shared/semver.ts";

const fixture = fromFileUrl(
  new URL("./fixtures/managed-version-baseline/", import.meta.url),
);
const Manifest = z.object({
  version: z.string(),
  schema: z.number(),
  snapshot_sha256: z.string(),
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

/** Read the frozen version and schema from the capture, independently of this binary. */
async function readManifest(): Promise<z.infer<typeof Manifest>> {
  return decodeWith(
    Manifest,
    await Deno.readTextFile(join(fixture, "manifest.json")),
  );
}

/** SHA-256 for the pinned archive, unpacked executable, and template inputs. */
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((
    byte,
  ) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read the archived capture and verify every member before executing it. */
async function readSnapshot(): Promise<Record<string, string>> {
  const manifest = await readManifest();
  const packed = await Deno.readFile(join(fixture, "snapshot.json.gz"));
  assertEquals(await digest(packed), manifest.snapshot_sha256);
  const unpacked = new Blob([packed]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  const snapshot = decodeWith(
    z.record(z.string(), z.string()),
    await new Response(unpacked).text(),
  );
  assertEquals(
    Object.keys(snapshot).sort(),
    Object.keys(manifest.files).sort(),
  );
  for (const [path, contents] of Object.entries(snapshot)) {
    assertEquals(
      await digest(new TextEncoder().encode(contents)),
      manifest.files[path],
      `frozen input changed: ${path}`,
    );
  }
  return snapshot;
}

/** Invoke the frozen executable with its frozen instruction template root. */
async function readFrozen(
  root: string,
  runtime: string,
): Promise<z.infer<typeof Reader>> {
  const run = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-config",
      "--no-lock",
      "--allow-read",
      "--allow-env",
      "--allow-run=git",
      "--ext=js",
      join(runtime, "reader.js"),
      root,
    ],
    env: { DISCERN_TEMPLATES_DIR: join(runtime, "templates") },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(run.success, new TextDecoder().decode(run.stderr));
  return decodeWith(Reader, new TextDecoder().decode(run.stdout));
}

Deno.test("first-public adoption reader and template are immutable compatibility inputs", async () => {
  const snapshot = await readSnapshot();
  // Keep the capture archived so repository searches find the live templates.
  const entries = await Array.fromAsync(Deno.readDir(fixture));
  assertEquals(entries.map((entry) => entry.name).sort(), [
    "README.md",
    "manifest.json",
    "snapshot.json.gz",
  ]);
  // Release guard: the recognized optional key must survive in the public reader.
  assertEquals(configSchema.parse({}).meta.managed_version, undefined);
  assertStringIncludes(renderConfigSchemaJson(), '"managed_version"');
  const template = snapshot["discern.toml.tmpl"];
  assert(template !== undefined);
  assert(!template.includes("managed_version ="));
});

Deno.test("frozen reader recognizes future adoption, skips old-template comparison, and withholds Proof", async () => {
  await withTempDir(async (runtime) => {
    for (const [path, contents] of Object.entries(await readSnapshot())) {
      const destination = join(runtime, path);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.writeTextFile(destination, contents);
    }
    const root = join(runtime, "project");
    await Deno.mkdir(root);
    const configPath = join(root, "discern.toml");
    const manifest = await readManifest();
    const newer = `${parseVersion(manifest.version).major + 1}.0.0`;
    const config =
      `[meta]\nschema_version = ${manifest.schema}\nbootstrapped = true\nmanaged_version = "${newer}"\n[project]\nagents = ["codex"]\n`;
    await Deno.writeTextFile(configPath, config);
    await Deno.writeTextFile(
      join(root, "AGENTS.md"),
      "# Material adopted by a newer release\n",
    );
    await gitInit(root);
    const ahead = await readFrozen(root, runtime);
    assertEquals(ahead.running, manifest.version);
    assertEquals(ahead.comparison?.state, "project-managed-by-newer");
    assertStringIncludes(ahead.boundary ?? "", "discern releases");
    assertEquals(ahead.currency?.state, "unverified");
    assertEquals(ahead.gate?.steps, []);
    assertEquals(await Deno.readTextFile(configPath), config);

    await Deno.writeTextFile(
      configPath,
      config.replace(`"${newer}"`, `"${manifest.version}"`),
    );
    await git(root, "add", "-A");
    await git(root, "commit", "-m", "same-version drift fixture");
    const equal = await readFrozen(root, runtime);
    assertEquals(equal.comparison?.state, "equal");
    assertEquals(equal.currency?.state, "checked");
    assert(equal.currency?.drift?.some((entry) => entry.path === "AGENTS.md"));

    await Deno.writeTextFile(
      configPath,
      config.replace(
        `schema_version = ${manifest.schema}`,
        `schema_version = ${manifest.schema + 1}`,
      ),
    );
    assertEquals(
      (await readFrozen(root, runtime)).error,
      "schema_version_too_new",
    );
    await Deno.writeTextFile(
      configPath,
      config.replace("managed_version", "installed_version"),
    );
    assertEquals((await readFrozen(root, runtime)).error, "invalid_config");
  });
});
