/** The Desk composes product state; the package owns generic terminal mechanics. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Check the public adoption boundary, independent of the consumer's file or binding names. */
function terminalMechanics(source: string): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile("candidate.ts", source);
  const findings: string[] = [];
  for (
    const declaration of [
      ...file.getImportDeclarations(),
      ...file.getExportDeclarations(),
    ]
  ) {
    const module = declaration.getModuleSpecifierValue() ?? "";
    const names = Node.isImportDeclaration(declaration)
      ? declaration.getNamedImports().map((item) => item.getName())
      : declaration.getNamedExports().map((item) => item.getName());
    if (
      /^(?:node:)?(?:tty|readline)(?:\/|$)/u.test(module) ||
      /(?:terminal_painter|\/lib\/text)\.ts$/u.test(module)
    ) {
      findings.push(`terminal transport or layout import: ${module}`);
    }
    if (module === "discern-design-system/cli") {
      if (
        (names.length === 0 ||
          names.some((name) =>
            name !== "createCliBlock" && !/^render.+Cli$/u.test(name)
          ))
      ) {
        findings.push("CLI foundation belongs in the package application");
      }
      if (
        Node.isImportDeclaration(declaration) &&
        (declaration.getNamespaceImport() || declaration.getDefaultImport())
      ) {
        findings.push("opaque CLI import bypasses component composition");
      }
    } else if (module.startsWith("discern-design-system/cli/")) {
      if (
        names.length === 0 || names.some((name) =>
          ![
            "TerminalApplicationContext",
            "TerminalApplicationView",
            "InteractionEntry",
          ].includes(name)
        )
      ) {
        findings.push(
          "interactive mechanics belong behind the terminal interaction adapter",
        );
      }
      if (
        Node.isImportDeclaration(declaration) &&
        (declaration.getNamespaceImport() || declaration.getDefaultImport())
      ) {
        findings.push("opaque interaction import bypasses the adapter");
      }
    }
    if (
      /\/lib\/terminal(?:_interaction)?\.ts$/u.test(module) &&
      names.some((name) =>
        /^(?:TerminalIO|TerminalSize|terminalSize|terminalInteractionIo|terminalPainter|create.*Painter)$/u
          .test(name)
      )
    ) {
      findings.push("raw terminal access belongs in the adapter");
    }
  }
  // Resolve simple namespace aliases and destructuring so renamed transports do not evade the boundary.
  const namespaces = new Set(["Deno", "process"]);
  for (const declaration of file.getImportDeclarations()) {
    if (
      ["process", "node:process"].includes(
        declaration.getModuleSpecifierValue(),
      )
    ) {
      const binding = declaration.getDefaultImport() ??
        declaration.getNamespaceImport();
      if (binding) namespaces.add(binding.getText());
      if (
        declaration.getNamedImports().some((item) =>
          /^(?:stdin|stdout|stderr)$/u.test(item.getName())
        )
      ) findings.push("imported terminal transport");
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of file.getVariableDeclarations()) {
      const value = declaration.getInitializer();
      if (
        value && namespaces.has(value.getText()) &&
        Node.isIdentifier(declaration.getNameNode()) &&
        !namespaces.has(declaration.getName())
      ) {
        namespaces.add(declaration.getName());
        changed = true;
      }
    }
  }
  for (const node of file.getDescendants()) {
    if (
      Node.isPropertyAccessExpression(node) &&
      namespaces.has(node.getExpression().getText()) &&
      /^(?:stdin|stdout|stderr|consoleSize)$/u.test(node.getName())
    ) {
      findings.push("direct terminal effect");
    }
    if (
      Node.isVariableDeclaration(node) &&
      namespaces.has(node.getInitializer()?.getText() ?? "") &&
      Node.isObjectBindingPattern(node.getNameNode())
    ) {
      for (
        const binding of node.getNameNode().getDescendantsOfKind(
          SyntaxKind.BindingElement,
        )
      ) {
        if (
          /^(?:stdin|stdout|stderr|consoleSize)$/u.test(
            binding.getPropertyNameNode()?.getText() ?? binding.getName(),
          )
        ) findings.push("destructured terminal effect");
      }
    }
    if (
      Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (node.getLiteralValue().includes("\x1b")) {
        findings.push("terminal control bytes");
      }
    }
  }
  return findings;
}

Deno.test("Desk terminal mechanics stay behind the package application boundary", async () => {
  const files = await structuralGuardScope({
    guard: "tests/engine_desk_terminal_guard_test.ts#package-application",
    universe: "authored-ts",
    narrow: {
      reason:
        "The Desk subtree is the adopted product application; unrelated inline commands retain their existing terminal adapters.",
      include: (path) => path.startsWith("src/engine/desk/"),
    },
  });
  for (const file of files) {
    assertEquals(
      terminalMechanics(await Deno.readTextFile(join(REPO_ROOT, file))),
      [],
      file,
    );
  }
});

Deno.test("Desk boundary rejects renamed future input, painting and layout implementations", () => {
  for (
    const source of [
      'import { fitTerminalLine as shape } from "discern-design-system/cli"; shape(value, width, caps);',
      'import { TerminalPainter as Canvas } from "discern-design-system/cli/interactive"; new Canvas(io);',
      'import { terminalSize as bounds } from "../../lib/text.ts"; bounds();',
      "const host = Deno; const channel = host.stdin; channel.read(buffer);",
      "const { stdout: canvas } = Deno; canvas.writeSync(bytes);",
      'export * from "discern-design-system/cli/interactive";',
      'import runtime from "node:process"; runtime.stdin.read();',
      'const redraw = "\\u001b[2J";',
    ]
  ) assertEquals(terminalMechanics(source).length > 0, true, source);
  assertEquals(
    terminalMechanics(
      'import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli"; const rows = tasks.map(task => ({ id: task.id, label: task.title })); const view = createCliBlock(renderMarkdownCli, {source: consent});',
    ),
    [],
  );
});
