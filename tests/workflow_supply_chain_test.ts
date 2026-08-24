/** Remote workflow actions are immutable, and release artifacts carry provenance. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const RELEASE = join(REPO_ROOT, ".github/workflows/release.yml");
const SHA = /^[0-9a-f]{40}$/;

interface ActionUse {
  action: string;
  line: number;
}

/** Extract external workflow action references with their source lines, excluding local actions. */
function remoteActionUses(source: string): ActionUse[] {
  const uses: ActionUse[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
    const action = match?.[1]?.replace(/^['"]|['"]$/g, "");
    if (action !== undefined && !action.startsWith("./")) {
      uses.push({ action, line: index + 1 });
    }
  }
  return uses;
}

/** Require an action reference to end in an immutable full commit SHA. */
function isPinned(action: string): boolean {
  const separator = action.lastIndexOf("@");
  return separator > 0 && SHA.test(action.slice(separator + 1));
}

Deno.test("every remote workflow action is pinned to an immutable commit", async () => {
  const failures: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/workflow_supply_chain_test.ts#remote-action-pinning",
    universe: "authored-text",
    narrow: {
      reason: "Remote action pinning governs every GitHub workflow YAML file.",
      include: (rel) =>
        rel.startsWith(".github/workflows/") && /\.ya?ml$/.test(rel),
    },
  });
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const use of remoteActionUses(source)) {
      if (!isPinned(use.action)) {
        failures.push(`${basename(rel)}:${use.line}: ${use.action}`);
      }
    }
  }
  assertEquals(
    failures,
    [],
    `unpinned workflow actions:\n${failures.join("\n")}`,
  );
});

Deno.test("a future remote action auto-enrols in the pin guard", () => {
  const fixture = `steps:
  - uses: ./local-action
  - uses: example/pinned@${"a".repeat(40)}
  - uses: example/future@v1
`;
  const actions = remoteActionUses(fixture);
  assertEquals(actions.map((use) => use.action), [
    `example/pinned@${"a".repeat(40)}`,
    "example/future@v1",
  ]);
  assert(isPinned(actions[0]?.action ?? ""));
  assert(!isPinned(actions[1]?.action ?? ""));
});

Deno.test("every published binary and checksum receives build provenance", async () => {
  const release = await Deno.readTextFile(RELEASE);
  const build = release.slice(
    release.indexOf("  build:"),
    release.indexOf("  release:"),
  );
  assertStringIncludes(build, "attestations: write");
  assertStringIncludes(build, "id-token: write");
  assertStringIncludes(
    build,
    "if: ${{ github.event.repository.private == false }}",
  );
  assertStringIncludes(build, "actions/attest-build-provenance@");
  assertStringIncludes(build, "dist/${{ matrix.output }}\n");
  assertStringIncludes(build, "dist/${{ matrix.output }}.sha256");
  assertStringIncludes(build, "name: ${{ matrix.output }}");

  const checksum = build.indexOf("- name: Checksum");
  const attest = build.indexOf("- name: Attest build provenance");
  const upload = build.indexOf("- name: Upload build artifacts");
  const cleanup = build.indexOf("- name: Remove Apple release credentials");
  assert(checksum >= 0, "the release creates a checksum");
  assert(
    attest > checksum,
    "provenance covers the completed binary + checksum",
  );
  assert(upload > attest, "attestation completes before artifact upload");
  assert(cleanup > upload, "ephemeral release credentials are removed last");
});

Deno.test("the pin guard scans the complete workflow directory", async () => {
  const names = (await structuralGuardScope({
    guard: "tests/workflow_supply_chain_test.ts#workflow-universe-control",
    universe: "authored-text",
    narrow: {
      reason:
        "This control proves Git-derived workflow YAML coverage stays populated.",
      include: (rel) =>
        rel.startsWith(".github/workflows/") && /\.ya?ml$/.test(rel),
    },
  })).map((rel) => basename(rel));
  assert(names.includes("gate.yml"));
  assert(names.includes("release.yml"));
});
