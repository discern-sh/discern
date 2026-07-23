/** Remote workflow actions are immutable, and release artifacts carry provenance. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, fromFileUrl, join } from "@std/path";

const WORKFLOWS = fromFileUrl(
  new URL("../.github/workflows/", import.meta.url),
);
const RELEASE = join(WORKFLOWS, "release.yml");
const SHA = /^[0-9a-f]{40}$/;

interface ActionUse {
  action: string;
  line: number;
}

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

function isPinned(action: string): boolean {
  const separator = action.lastIndexOf("@");
  return separator > 0 && SHA.test(action.slice(separator + 1));
}

Deno.test("every remote workflow action is pinned to an immutable commit", async () => {
  const failures: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS)) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) {
      continue;
    }
    const source = await Deno.readTextFile(join(WORKFLOWS, entry.name));
    for (const use of remoteActionUses(source)) {
      if (!isPinned(use.action)) {
        failures.push(`${entry.name}:${use.line}: ${use.action}`);
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
  assert(checksum >= 0, "the release creates a checksum");
  assert(
    attest > checksum,
    "provenance covers the completed binary + checksum",
  );
  assert(upload > attest, "attestation completes before artifact upload");
});

Deno.test("the pin guard scans the complete workflow directory", async () => {
  const names: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS)) {
    if (entry.isFile && /\.ya?ml$/.test(entry.name)) {
      names.push(basename(entry.name));
    }
  }
  assert(names.includes("gate.yml"));
  assert(names.includes("release.yml"));
});
