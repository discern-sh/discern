/** Registration-free import inspection shared by architectural test boundaries. */
import { ts } from "ts-morph";

/** Static and literal dynamic imports; unresolved dynamic imports remain explicit. */
export function importSpecifiers(
  source: string,
  options: { readonly runtimeOnly?: boolean } = {},
): { specifiers: string[]; unwalkableDynamicImport: boolean } {
  const parsed = ts.createSourceFile(
    "guard-input.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  for (const statement of parsed.statements) {
    if (
      !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)
    ) continue;
    if (options.runtimeOnly) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        const named = clause?.namedBindings;
        if (
          clause?.isTypeOnly ||
          (clause?.name === undefined && named !== undefined &&
            ts.isNamedImports(named) && named.elements.length > 0 &&
            named.elements.every((element) => element.isTypeOnly))
        ) continue;
      } else if (
        statement.isTypeOnly || (statement.exportClause !== undefined &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length > 0 &&
          statement.exportClause.elements.every((element) =>
            element.isTypeOnly
          ))
      ) continue;
    }
    if (
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) specifiers.push(statement.moduleSpecifier.text);
  }
  let unwalkableDynamicImport = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      } else unwalkableDynamicImport = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return { specifiers, unwalkableDynamicImport };
}

/** Native test filenames denote registration modules, never reusable helper libraries. */
export function testRegistrationImports(source: string): string[] {
  return importSpecifiers(source, { runtimeOnly: true }).specifiers.filter((
    specifier,
  ) =>
    /(?:^|\/)(?:test|[^/]+[._]test)\.(?:[cm]?[jt]s|[jt]sx)(?:[?#].*)?$/.test(
      specifier,
    )
  );
}
