/** Full-universe guard for direct test timers and real-delay enrollment. */

import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./temp_dir.ts";
import { join } from "@std/path";
import { waitingFindings, waitingSources } from "./test_waiting_guard.ts";
import { TEST_REAL_DELAY_BOUNDARIES } from "./waiting.ts";

/** Construct adversarial source without planting a live raw timer in this file. */
function rawTimerSource(api: "timeout" | "interval"): string {
  const name = api === "timeout" ? "set" + "Timeout" : "set" + "Interval";
  return `const token = ${name}(() => undefined, 1);\n`;
}

Deno.test("test waiting guard rejects raw timers across tests, future fixture roots, and embedded child source", async () => {
  await withTempDir(async (root) => {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: root }).output();
    const fixtures = [
      ["tests/ordinary_test.ts", rawTimerSource("timeout")],
      ["tests/future-fixtures/new-root/program.ts", rawTimerSource("interval")],
      [
        "tests/embedded_child_test.ts",
        `const childSource = ${JSON.stringify(rawTimerSource("timeout"))};\n`,
      ],
    ] as const;
    for (const [path, source] of fixtures) {
      await Deno.mkdir(join(root, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, path), source);
    }
    const findings = waitingFindings(await waitingSources(root), {});
    assertEquals(findings.length, 3);
    assert(
      findings.some((finding) => finding.startsWith("tests/ordinary_test.ts:")),
    );
    assert(
      findings.some((finding) =>
        finding.startsWith("tests/future-fixtures/new-root/program.ts:")
      ),
    );
    assert(
      findings.some((finding) =>
        finding.startsWith("tests/embedded_child_test.ts:")
      ),
    );
  });
});

Deno.test("test waiting guard binds unknown, stale, duplicate, and misplaced real-delay IDs", () => {
  const callName = "real" + "Delay";
  const sources = [
    {
      path: "tests/example_test.ts",
      source: [
        "Deno.test('registered operation', () => {});",
        `${callName}("known", 1);`,
        `${callName}("known", 2);`,
        `${callName}("unknown", 3);`,
        `${callName}(dynamicId, 4);`,
      ].join("\n"),
    },
  ];
  const findings = waitingFindings(sources, {
    known: {
      path: "tests/elsewhere_test.ts",
      enclosing: "registered operation",
      operation: "exercise a known duration",
      reason: "the synthetic registry proves exact call-site parity",
      classification: "adversarial-stimulus",
    },
    stale: {
      path: "tests/example_test.ts",
      enclosing: "registered operation",
      operation: "exercise a removed duration",
      reason: "the synthetic registry proves stale members fail",
      classification: "adversarial-stimulus",
    },
  });
  assert(
    findings.some((finding) =>
      finding.includes("unknown realDelay boundary 'unknown'")
    ),
  );
  assert(
    findings.some((finding) =>
      finding.includes("boundary id must be a string literal")
    ),
  );
  assert(
    findings.some((finding) =>
      finding.includes("boundary 'stale' has no call site")
    ),
  );
  assert(
    findings.some((finding) =>
      finding.includes("boundary 'known' has 2 call sites")
    ),
  );
  assert(
    findings.some((finding) =>
      finding.includes("registered at tests/elsewhere_test.ts")
    ),
  );
});

Deno.test("test waiting guard auto-enrols a fresh real-delay container while leaving semantic judgment visible", async () => {
  await withTempDir(async (root) => {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: root }).output();
    const path = "tests/foreign-rig/scenes/unrelated_fixture.ts";
    const callName = "real" + "Delay";
    await Deno.mkdir(join(root, path, ".."), { recursive: true });
    await Deno.writeTextFile(
      join(root, path),
      [
        "Deno.test('opaque external transition', () => {});",
        `${callName}("opaque-window", 1);`,
      ].join("\n"),
    );

    const sources = await waitingSources(root);
    assert(
      sources.some((source) => source.path === path),
      "a new fixture container must join the Git-derived waiting universe",
    );
    assert(
      waitingFindings(sources, {}).some((finding) =>
        finding.includes("unknown realDelay boundary 'opaque-window'")
      ),
    );
    assertEquals(
      waitingFindings(sources, {
        "opaque-window": {
          path,
          enclosing: "opaque external transition",
          operation: "wait because the synthetic fixture exposes no marker",
          reason:
            "Mechanical enrollment can bind this claim, but only semantic review can reject elapsed readiness evidence.",
          classification: "adversarial-stimulus",
        },
      }),
      [],
    );
  });
});

Deno.test("test waiting guard holds the live timer and real-delay population", async () => {
  assertEquals(await waitingFindings(await waitingSources()), []);
  assert(Object.keys(TEST_REAL_DELAY_BOUNDARIES).length > 0);
});
