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
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

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
    const fieldEnvelope = decodeCliResult(field.stdout, "identity");
    assertResultDataKey(fieldEnvelope, "kind");
    assertEquals(fieldEnvelope.ok, true);
    assertEquals(fieldEnvelope.verb, "identity");
    assert(fieldEnvelope.data.kind === "field");
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
    const resourceEnvelope = decodeCliResult(resource.stdout, "identity");
    assertResultDataKey(resourceEnvelope, "kind");
    assert(resourceEnvelope.data.kind === "resource");
    assertEquals(resourceEnvelope.data.name, "cache");
    assertEquals(typeof resourceEnvelope.data.value, "string");

    const resources = await runAgent(worktree, [
      "identity",
      "--resources",
      "--json",
    ]);
    assertEquals(resources.code, 0, resources.output);
    const resourcesEnvelope = decodeCliResult(resources.stdout, "identity");
    assertResultDataKey(resourcesEnvelope, "kind");
    assert(resourcesEnvelope.data.kind === "resources");
    assertEquals(resourcesEnvelope.data.resources, {});
  });
});

Deno.test("identity JSON failures distinguish resolution from malformed arguments", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const humanResolution = await runAgent(dir, ["identity"]);
    assert(humanResolution.code !== 0, humanResolution.output);
    assertEquals(humanResolution.stdout, "");
    assert(
      humanResolution.stderr.startsWith("✕ "),
      humanResolution.output,
    );

    const resolution = await runAgent(dir, ["identity", "--json"]);
    assert(resolution.code !== 0, resolution.output);
    assertEquals(resolution.stderr, "");
    const resolutionEnvelope = decodeCliResult(resolution.stdout, "identity");
    assertEquals(resolutionEnvelope.ok, false);
    assertEquals(resolutionEnvelope.verb, "identity");
    assertEquals(resolutionEnvelope.error, "identity_error");
    assert(
      Array.isArray(resolutionEnvelope.hints) &&
        resolutionEnvelope.hints.length > 0,
    );

    const humanMalformed = await runAgent(dir, [
      "identity",
      "--id",
      "--site",
    ]);
    assertEquals(humanMalformed.code, 1, humanMalformed.output);
    assertEquals(humanMalformed.stdout, "");
    assert(
      humanMalformed.stderr.startsWith("✕ "),
      humanMalformed.output,
    );

    const malformed = await runAgent(dir, [
      "identity",
      "--id",
      "--site",
      "--json",
    ]);
    assertEquals(malformed.code, 1, malformed.output);
    assertEquals(malformed.stderr, "");
    const malformedEnvelope = decodeCliResult(malformed.stdout, "identity");
    assertEquals(malformedEnvelope.ok, false);
    assertEquals(malformedEnvelope.verb, "identity");
    assertEquals(malformedEnvelope.error, "invalid_arguments");
    assert(
      Array.isArray(malformedEnvelope.hints) &&
        malformedEnvelope.hints.length > 0,
    );
  });
});
