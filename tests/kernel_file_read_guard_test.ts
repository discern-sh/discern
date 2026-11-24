/**
 * Kernel pseudo-filesystem paths reach only the child-process reader.
 *
 * Deno grants its own reads of `/proc` and `/sys` only under all-access
 * permission, and applies that rule on Linux alone. The compiled binary
 * carries a narrower permission set, so a direct read passes every check on
 * another host and crashes on Linux. In the binary's source a path literal
 * under those roots is therefore legal only as the argument of
 * `readKernelFile`, which reads through a child process.
 */

import { assert, assertEquals } from "@std/assert";
import { Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";

const KERNEL_PATH = /^\/(?:proc|sys)(?:\/|$)/u;
/** A cheap text test that spares the syntax tree for files naming no kernel root. */
const KERNEL_ROOT_MENTION = /\/(?:proc|sys)\b/u;
const READER = "readKernelFile";

interface KernelPathUse {
  readonly literal: string;
  readonly line: number;
  readonly sanctioned: boolean;
}

/** Every string that names a kernel path, and whether the reader receives it. */
function kernelPathUses(source: string): KernelPathUse[] {
  const file = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
  }).createSourceFile("subject.ts", source);
  const uses: KernelPathUse[] = [];
  for (
    const literal of [
      ...file.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...file.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ]
  ) {
    if (!KERNEL_PATH.test(literal.getLiteralText())) continue;
    const call = literal.getParentIfKind(SyntaxKind.CallExpression);
    uses.push({
      literal: literal.getLiteralText(),
      line: literal.getStartLineNumber(),
      sanctioned: call?.getExpression().getText() === READER &&
        call.getArguments()[0] === literal,
    });
  }
  // A template with substitutions still fixes its root in the head.
  for (
    const template of file.getDescendantsOfKind(SyntaxKind.TemplateExpression)
  ) {
    const head = template.getHead().getLiteralText();
    if (!KERNEL_PATH.test(head)) continue;
    uses.push({
      literal: `${head}\${…}`,
      line: template.getStartLineNumber(),
      sanctioned: false,
    });
  }
  return uses;
}

Deno.test("the binary's source reads kernel paths only through the child-process reader", async () => {
  const sources = await readScopedSources(
    REPO_ROOT,
    await structuralGuardScope({
      guard: "tests/kernel_file_read_guard_test.ts#kernel-paths-use-the-reader",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only src/ compiles into the binary, whose permission set omits the all-access Deno requires for these paths.",
        include: (path) => path.startsWith("src/"),
      },
    }),
  );
  const uses = sources
    .filter(({ source }) => KERNEL_ROOT_MENTION.test(source))
    .flatMap(({ path, source }) =>
      kernelPathUses(source).map((use) => ({ path, ...use }))
    );
  assertEquals(
    uses.filter((use) => !use.sanctioned).map((use) =>
      `${use.path}:${use.line}: "${use.literal}" must be read with ${READER}(…) from src/shared/subprocess.ts — Deno refuses a direct read on Linux without all-access`
    ),
    [],
  );
  assert(
    uses.some((use) => use.sanctioned),
    "the guard must observe the sanctioned reader in use",
  );
});

Deno.test("the kernel-path detector separates direct reads from the reader", () => {
  const uses = kernelPathUses([
    'await readKernelFile("/proc/self/mountinfo");',
    'await Deno.readTextFile("/proc/self/status");',
    "await Deno.readTextFile(`/sys/class/net`);",
    "await Deno.readTextFile(`/proc/${pid}/stat`);",
    'await readKernelFile(join("/proc", "self"));',
    'const data = { mountPoint: "/process", device: "/dev/sda" };',
  ].join("\n"));
  assertEquals(
    uses.map((use) => [use.literal, use.sanctioned]).sort(),
    [
      ["/proc", false],
      ["/proc/${…}", false],
      ["/proc/self/mountinfo", true],
      ["/proc/self/status", false],
      ["/sys/class/net", false],
    ],
  );
});
