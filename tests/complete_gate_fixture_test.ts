/** A complete reader fixture must pass the real writer; incomplete markers remain stale. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import { completeGateFixture } from "./complete_gate_fixture.ts";
import {
  inspectGateProof,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
} from "../src/engine/gate/proof.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

Deno.test("complete marker fixtures require current receipts and never upgrade incomplete records", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/subject`, "committed fixture\n");
    await gitInit(root);
    const fixture = await completeGateFixture(root);
    const authority = await preflightAdminStateWrites(root);
    assert(authority.ok);
    const pin = await pinValidatedTree(root);
    assertEquals(
      (await recordGateOutcome(
        root,
        authority.authority,
        true,
        pin,
        fixture.proof,
      )).status,
      "unavailable",
    );
    const recorded = await recordGateOutcome(
      root,
      authority.authority,
      true,
      pin,
      fixture.proof,
      undefined,
      "strict",
      fixture.pointer,
    );
    assertEquals(recorded.status, "recorded");
    assertEquals((await inspectGateProof(root)).status, "honored");
    assert(recorded.path !== undefined);
    const incomplete = JSON.stringify({
      version: ON_DISK_FORMATS.gateProof.version,
      head: pin.head,
      mode: "strict",
    });
    await Deno.writeTextFile(recorded.path, incomplete);
    assertEquals((await inspectGateProof(root)).status, "stale");
    assertEquals(await Deno.readTextFile(recorded.path), incomplete);
  });
});
