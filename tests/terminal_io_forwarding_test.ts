/** Forwarding a terminal read also forwards its optional native cancellation. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Follow literal and conditional spreads that can supply the port's own hook. */
function cancellationHooks(node: Node): Node[] {
  if (Node.isParenthesizedExpression(node) || Node.isSpreadAssignment(node)) {
    return cancellationHooks(node.getExpression());
  }
  if (Node.isConditionalExpression(node)) {
    return [
      ...cancellationHooks(node.getWhenTrue()),
      ...cancellationHooks(node.getWhenFalse()),
    ];
  }
  if (!Node.isObjectLiteralExpression(node)) return [];
  return node.getProperties().flatMap((property) => {
    if (Node.isSpreadAssignment(property)) return cancellationHooks(property);
    return property.getName() === "cancelRead" ? [property] : [];
  });
}

/** Find reconstructed terminal ports whose delegated read loses cancellation. */
function lostReadCancellation(source: string): number[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile("candidate.ts", source);
  const findings: number[] = [];
  for (
    const port of file.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)
  ) {
    if (
      port.getProperty("isInteractive") === undefined ||
      port.getProperty("setRawMode") === undefined
    ) continue;
    const read = port.getProperty("read");
    if (read === undefined) continue;
    for (const call of read.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const member = call.getExpression();
      if (
        !Node.isPropertyAccessExpression(member) || member.getName() !== "read"
      ) continue;
      const receiver = member.getExpression().getText();
      const forwardsCancellation = cancellationHooks(port).flatMap((hook) =>
        hook.getDescendantsOfKind(SyntaxKind.CallExpression)
      ).some((candidate) => {
        const effect = candidate.getExpression();
        return Node.isPropertyAccessExpression(effect) &&
          effect.getName() === "cancelRead" &&
          effect.getExpression().getText() === receiver;
      });
      if (!forwardsCancellation) findings.push(read.getStartLineNumber());
    }
  }
  return findings;
}

Deno.test("terminal read forwarding detects fresh wrappers independently of names", () => {
  const fresh =
    `const orbit = { isInteractive: () => creek.isInteractive(), setRawMode: flag => creek.setRawMode(flag), read: async () => await creek.read() };`;
  assertEquals(lostReadCancellation(fresh), [1]);
  assertEquals(
    lostReadCancellation(
      fresh.replace(
        "read: async",
        "cancelRead: () => creek.cancelRead?.() ?? false, read: async",
      ),
    ),
    [],
  );
  assertEquals(
    lostReadCancellation(
      fresh.replace(
        "read: async",
        "cancelRead: () => somebodyElse.cancelRead?.() ?? false, read: async",
      ),
    ),
    [1],
  );
  for (
    const misplaced of [
      "write: () => creek.cancelRead?.(), read: async",
      "unrelated: { cancelRead: () => creek.cancelRead?.() }, read: async",
      "...(flag ? { unrelated: { cancelRead: () => creek.cancelRead?.() } } : {}), read: async",
    ]
  ) {
    assertEquals(
      lostReadCancellation(fresh.replace("read: async", misplaced)),
      [1],
    );
  }
  assertEquals(
    lostReadCancellation(
      fresh.replace(
        "read: async",
        "...(creek.cancelRead === undefined ? {} : { cancelRead: () => creek.cancelRead() }), read: async",
      ),
    ),
    [],
  );
  assertEquals(
    lostReadCancellation(fresh.replace("await creek.read()", "null")),
    [],
  );
});

Deno.test("every reconstructed terminal read preserves native cancellation", async () => {
  const findings: string[] = [];
  for (
    const path of await structuralGuardScope({
      guard: "tests/terminal_io_forwarding_test.ts#native-read-forwarding",
      universe: {
        kind: "specialized",
        name: "TypeScript terminal adapters including executable fixtures",
        reason:
          "Executable fixtures forward native terminal reads just as production adapters do; the authored universe excludes those fixtures.",
        extensions: [".ts", ".tsx"],
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    for (const line of lostReadCancellation(source)) {
      findings.push(`${path}:${line}`);
    }
  }
  assertEquals(findings, []);
});
