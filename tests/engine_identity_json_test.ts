/**
 * The identity command's dual surface: shell-friendly bare values without a
 * flag, and one structured result envelope under `--json`.
 */

import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

Deno.test("identity preserves bare output and publishes structured JSON values", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "identity-json");

    const raw = await runAgent(worktree, ["identity", "--id"]);
    assertEquals(raw.code, 0, raw.output);
    assertEquals(raw.stdout, "identity-json\n");

    const field = await runAgent(worktree, [
      "identity",
      "--port",
      "--json",
    ]);
    assertEquals(field.code, 0, field.output);
    assertEquals(field.stderr, "");
    const fieldEnvelope = JSON.parse(field.stdout);
    assertEquals(fieldEnvelope.ok, true);
    assertEquals(fieldEnvelope.verb, "identity");
    assertEquals(fieldEnvelope.data.kind, "field");
    assertEquals(fieldEnvelope.data.field, "port");
    assert(
      typeof fieldEnvelope.data.value === "string" &&
        /^\d+$/.test(fieldEnvelope.data.value),
    );

    const resource = await runAgent(worktree, [
      "identity",
      "--resource",
      "cache",
      "--json",
    ]);
    assertEquals(resource.code, 0, resource.output);
    const resourceEnvelope = JSON.parse(resource.stdout);
    assertEquals(resourceEnvelope.data.kind, "resource");
    assertEquals(resourceEnvelope.data.name, "cache");
    assertEquals(typeof resourceEnvelope.data.value, "string");

    const resources = await runAgent(worktree, [
      "identity",
      "--resources",
      "--json",
    ]);
    assertEquals(resources.code, 0, resources.output);
    const resourcesEnvelope = JSON.parse(resources.stdout);
    assertEquals(resourcesEnvelope.data.kind, "resources");
    assertEquals(resourcesEnvelope.data.resources, {});
  });
});

Deno.test("identity JSON failures distinguish resolution from malformed arguments", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const resolution = await runAgent(dir, ["identity", "--json"]);
    assert(resolution.code !== 0, resolution.output);
    assertEquals(resolution.stderr, "");
    const resolutionEnvelope = JSON.parse(resolution.stdout);
    assertEquals(resolutionEnvelope.ok, false);
    assertEquals(resolutionEnvelope.verb, "identity");
    assertEquals(resolutionEnvelope.error, "identity_error");
    assert(
      Array.isArray(resolutionEnvelope.hints) &&
        resolutionEnvelope.hints.length > 0,
    );

    const malformed = await runAgent(dir, [
      "identity",
      "--id",
      "--site",
      "--json",
    ]);
    assertEquals(malformed.code, 1, malformed.output);
    assertEquals(malformed.stderr, "");
    const malformedEnvelope = JSON.parse(malformed.stdout);
    assertEquals(malformedEnvelope.ok, false);
    assertEquals(malformedEnvelope.verb, "identity");
    assertEquals(malformedEnvelope.error, "invalid_arguments");
    assert(
      Array.isArray(malformedEnvelope.hints) &&
        malformedEnvelope.hints.length > 0,
    );
  });
});
