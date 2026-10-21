/**
 * Call-site enrollment scanning shared by structural guards that enroll every
 * shipped use of a closed set of functions by the function it sits in, keyed
 * `<module>#<enclosing function>`. Declarations, imports, exports, and JSDoc
 * mentions are not uses; an aliased import or destructuring binds a use too.
 */

import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const PROJECT = new Project({
  compilerOptions: { noLib: true },
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
});

/** Parse one source into the shared in-memory project. */
export function parseSource(path: string, text: string): SourceFile {
  return PROJECT.createSourceFile(path, text, { overwrite: true });
}

/** Whether an identifier names a declaration rather than reading the accessor. */
function isDeclarationName(id: Node): boolean {
  const parent = id.getParent();
  if (parent === undefined) return true;
  if (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent)) {
    return true;
  }
  if (Node.isBindingElement(parent) && parent.getNameNode() === id) {
    return true;
  }
  return (Node.isFunctionDeclaration(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isPropertySignature(parent) ||
    Node.isPropertyAssignment(parent) ||
    Node.isVariableDeclaration(parent)) &&
    parent.getNameNode() === id;
}

/** Whether an identifier reads a local variable or parameter that shadows an
 * accessor's name, rather than the accessor. */
function readsShadowingLocal(id: Node, file: SourceFile): boolean {
  const declaration = id.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return false;
  if (Node.isParameterDeclaration(declaration)) return true;
  return Node.isVariableDeclaration(declaration) &&
    declaration.getVariableStatement()?.getParent() !== file;
}

/** Name the function, or the top-level binding, a node sits in. */
function enclosingName(node: Node, file: SourceFile): string {
  for (let current = node.getParent(); current; current = current.getParent()) {
    if (
      Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)
    ) {
      return current.getName() ?? "<anonymous>";
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const holder = current.getParent();
      if (
        holder !== undefined &&
        (Node.isVariableDeclaration(holder) ||
          Node.isPropertyAssignment(holder))
      ) {
        return holder.getName();
      }
    }
    if (
      Node.isVariableDeclaration(current) &&
      current.getVariableStatement()?.getParent() === file
    ) {
      return current.getName();
    }
  }
  return "<module>";
}

/** Each local name a source reads an accessor through — the accessor itself,
 * or an alias bound by an aliased import or destructuring — mapped to the
 * accessor it stands for. */
function accessorNames(
  file: SourceFile,
  accessors: ReadonlySet<string>,
): Map<string, string> {
  const names = new Map([...accessors].map((name) => [name, name]));
  for (const named of file.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    const alias = named.getAliasNode();
    if (alias !== undefined && accessors.has(named.getName())) {
      names.set(alias.getText(), named.getName());
    }
  }
  for (const binding of file.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    const property = binding.getPropertyNameNode();
    if (property !== undefined && accessors.has(property.getText())) {
      names.set(binding.getName(), property.getText());
    }
  }
  return names;
}

/** Every use of an accessor in one source, with the site it sits in. */
function accessorUseList(
  path: string,
  text: string,
  accessors: ReadonlySet<string>,
): { site: string; accessor: string }[] {
  const file = parseSource(path, text);
  const names = accessorNames(file, accessors);
  const uses: { site: string; accessor: string }[] = [];
  for (const id of file.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const accessor = names.get(id.getText());
    if (accessor === undefined || isDeclarationName(id)) continue;
    if (id.getFirstAncestor((node) => Node.isJSDoc(node)) !== undefined) {
      continue;
    }
    if (readsShadowingLocal(id, file)) continue;
    uses.push({ site: `${path}#${enclosingName(id, file)}`, accessor });
  }
  return uses;
}

/** The `<module>#<function>` sites in one source that use any accessor. */
export function accessorSites(
  path: string,
  text: string,
  accessors: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(accessorUseList(path, text, accessors).map(({ site }) => site)),
  ].sort();
}

/** The `<module>#<function> > <accessor>` uses in one source, so one site
 * that calls several accessors enrolls each call's posture separately. */
export function accessorUses(
  path: string,
  text: string,
  accessors: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      accessorUseList(path, text, accessors).map(({ site, accessor }) =>
        `${site} > ${accessor}`
      ),
    ),
  ].sort();
}
