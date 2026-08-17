/**
 * Structural resolution over the five prose registries.
 *
 * Canon Editor reads the canon two independent ways: module evaluation for
 * what the prose says (the snapshot), and this syntax-level view for where it
 * says it — the exact positions the IDE jump lands on and the literal nodes
 * write-back may replace. Field semantics (which paths are editable prose,
 * which are pickers, which stay locked) layer on top in fields.ts; this module
 * answers only "which entries exist", "where", and "what literal sits at this
 * path".
 *
 * Everything here is syntax-only: no type checking, no module evaluation, no
 * import resolution — opening the five registry files stays fast and can never
 * execute registry code.
 */

import { join } from "@std/path";
import { Node, Project } from "ts-morph";
import { slugify } from "./annotation.ts";
import type {
  Expression,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
} from "ts-morph";

/** The five prose registries Canon Editor serves. */
export type RegistryName =
  | "feature"
  | "benefit"
  | "practice"
  | "glossary"
  | "claims";

/** Where one registry lives and how its entries are keyed and nested. */
export interface RegistrySpec {
  readonly name: RegistryName;
  /** Repo-relative source module. */
  readonly file: string;
  /** The exported declaration holding the registry data. */
  readonly exportName: string;
  /**
   * The property identifying an entry, or "key" when the registry is an
   * object literal keyed by slug (the claims ledger).
   */
  readonly keyField: "id" | "term" | "key";
  /** The property holding nested child entries, when the registry nests. */
  readonly childField?: "children" | "benefits";
  /** Entry kind labels by nesting depth; the last label covers deeper levels. */
  readonly kinds: readonly string[];
}

/** The registry roster, in the canons' own reading order. */
export const PROSE_REGISTRIES: readonly RegistrySpec[] = [
  {
    name: "feature",
    file: "scripts/feature_registry.ts",
    exportName: "FEATURE_CANON",
    keyField: "id",
    childField: "children",
    kinds: ["pillar", "node"],
  },
  {
    name: "benefit",
    file: "scripts/feature_registry.ts",
    exportName: "BENEFIT_CANON",
    keyField: "id",
    childField: "benefits",
    kinds: ["cluster", "benefit"],
  },
  {
    name: "practice",
    file: "scripts/practice_registry.ts",
    exportName: "PRACTICE_CANON",
    keyField: "id",
    kinds: ["tenet"],
  },
  {
    name: "glossary",
    file: "scripts/glossary_registry.ts",
    exportName: "GLOSSARY",
    keyField: "term",
    kinds: ["term"],
  },
  {
    name: "claims",
    file: "scripts/brand/claims.ts",
    exportName: "CLAIMS",
    keyField: "key",
    kinds: ["claim"],
  },
];

/** One canon entry resolved to its source position. */
export interface CanonEntryRef {
  readonly registry: RegistryName;
  /** The entry's identity: node/benefit/tenet id, glossary term, claim slug. */
  readonly id: string;
  /** Lowercased dashed form of the id, for forgiving lookups. */
  readonly slug: string;
  /** Display title when the entry declares one; the id otherwise. */
  readonly title: string;
  /** pillar, node, cluster, benefit, tenet, term, or claim. */
  readonly kind: string;
  /** The enclosing entry's id, for nested nodes and clustered benefits. */
  readonly parent?: string;
  /** Repo-relative source module. */
  readonly file: string;
  /** 1-based line of the identifying property — the IDE jump target. */
  readonly line: number;
  /** The entry's object literal, for field resolution and write-back. */
  readonly node: ObjectLiteralExpression;
}

/** How a field's value literal may be handled by the editor. */
export type FieldValueKind =
  /** A plain string literal — editable prose. */
  | "string"
  /** An array of plain string literals — editable as a typed list. */
  | "string-array"
  /** A template literal (interpolated or tagged) — derived, locked. */
  | "template"
  /** A nested object literal — recurse into its own leaves. */
  | "object"
  /** An array with non-string elements — recurse or lock per element. */
  | "array"
  /** Any other expression (a call, a spread) — derived, locked. */
  | "computed";

/** A field path resolved to its value literal. */
export interface FieldTarget {
  readonly path: string;
  readonly kind: FieldValueKind;
  /** 1-based line of the value literal. */
  readonly line: number;
  /** The value node itself. */
  readonly node: Node;
}

/** One leaf in an entry's complete field inventory. */
export interface FieldLeaf {
  readonly path: string;
  readonly kind: FieldValueKind;
  readonly line: number;
}

/**
 * Open the registry sources as a syntax-only ts-morph project. Dependency
 * resolution is skipped deliberately: entries and literals resolve without
 * type information, so the registries' import graphs never load and nothing
 * ever executes.
 */
export function openRegistryProject(root: string): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  const files = new Set(PROSE_REGISTRIES.map((spec) => spec.file));
  for (const file of files) {
    project.addSourceFileAtPath(join(root, file));
  }
  return project;
}

/** Peel `as const`, `satisfies`, and parentheses off an expression. */
function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/** A property's key text, unquoting string-literal keys like claim slugs. */
function propertyKeyText(property: PropertyAssignment): string {
  const nameNode = property.getNameNode();
  return Node.isStringLiteral(nameNode)
    ? nameNode.getLiteralValue()
    : nameNode.getText();
}

/** The string value of an entry's own property, when it is a plain literal. */
function readStringProperty(
  object: ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = object.getProperty(name);
  if (property === undefined || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = property.getInitializer();
  return initializer !== undefined && Node.isStringLiteral(initializer)
    ? initializer.getLiteralValue()
    : undefined;
}

/** The kind label a registry gives entries at a nesting depth. */
function kindAtDepth(spec: RegistrySpec, depth: number): string {
  const label = spec.kinds[Math.min(depth, spec.kinds.length - 1)];
  if (label === undefined) {
    throw new Error(`registry ${spec.name} declares no entry kinds`);
  }
  return label;
}

/** Classify a value literal by what the editor may do with it. */
function classifyValue(node: Node): FieldValueKind {
  if (Node.isStringLiteral(node)) return "string";
  if (
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node) ||
    Node.isTaggedTemplateExpression(node)
  ) {
    return "template";
  }
  if (Node.isArrayLiteralExpression(node)) {
    const allStrings = node
      .getElements()
      .every((element) => Node.isStringLiteral(element));
    return allStrings ? "string-array" : "array";
  }
  if (Node.isObjectLiteralExpression(node)) return "object";
  return "computed";
}

/** Build the entry reference for one resolved object literal. */
function entryRef(
  spec: RegistrySpec,
  object: ObjectLiteralExpression,
  depth: number,
  parent: string | undefined,
  id: string,
  line: number,
): CanonEntryRef {
  const title = readStringProperty(object, "title") ?? id;
  return {
    registry: spec.name,
    id,
    slug: slugify(id),
    title,
    kind: kindAtDepth(spec, depth),
    ...(parent === undefined ? {} : { parent }),
    file: spec.file,
    line,
    node: object,
  };
}

/** Collect entries from an array-shaped registry, recursing into children. */
function collectArrayEntries(
  spec: RegistrySpec,
  array: Expression,
  depth: number,
  parent: string | undefined,
  into: CanonEntryRef[],
): void {
  const unwrapped = unwrapExpression(array);
  if (!Node.isArrayLiteralExpression(unwrapped)) {
    throw new Error(
      `${spec.file}: ${spec.exportName} is not an array literal at depth ${depth}`,
    );
  }
  for (const element of unwrapped.getElements()) {
    const object = unwrapExpression(element);
    if (!Node.isObjectLiteralExpression(object)) continue;
    const keyProperty = object.getProperty(spec.keyField);
    if (keyProperty === undefined || !Node.isPropertyAssignment(keyProperty)) {
      throw new Error(
        `${spec.file}: an ${spec.exportName} entry at line ${object.getStartLineNumber()} has no ${spec.keyField} property`,
      );
    }
    const initializer = keyProperty.getInitializer();
    if (initializer === undefined || !Node.isStringLiteral(initializer)) {
      throw new Error(
        `${spec.file}: the ${spec.keyField} at line ${keyProperty.getStartLineNumber()} is not a string literal`,
      );
    }
    const id = initializer.getLiteralValue();
    into.push(
      entryRef(
        spec,
        object,
        depth,
        parent,
        id,
        keyProperty.getStartLineNumber(),
      ),
    );
    if (spec.childField !== undefined) {
      const children = object.getProperty(spec.childField);
      if (children !== undefined && Node.isPropertyAssignment(children)) {
        const value = children.getInitializer();
        if (value !== undefined) {
          collectArrayEntries(spec, value, depth + 1, id, into);
        }
      }
    }
  }
}

/** Collect entries from an object-shaped registry (the claims ledger). */
function collectKeyedEntries(
  spec: RegistrySpec,
  object: Expression,
  into: CanonEntryRef[],
): void {
  const unwrapped = unwrapExpression(object);
  if (!Node.isObjectLiteralExpression(unwrapped)) {
    throw new Error(
      `${spec.file}: ${spec.exportName} is not an object literal`,
    );
  }
  for (const property of unwrapped.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const value = property.getInitializer();
    if (value === undefined) continue;
    const entryObject = unwrapExpression(value);
    if (!Node.isObjectLiteralExpression(entryObject)) continue;
    const id = propertyKeyText(property);
    into.push(
      entryRef(
        spec,
        entryObject,
        0,
        undefined,
        id,
        property.getStartLineNumber(),
      ),
    );
  }
}

/** The registry export's initializer within an opened source file. */
function registryInitializer(
  source: SourceFile,
  spec: RegistrySpec,
): Expression {
  const declaration = source.getVariableDeclaration(spec.exportName);
  if (declaration === undefined) {
    throw new Error(`${spec.file}: no declaration named ${spec.exportName}`);
  }
  const initializer = declaration.getInitializer();
  if (initializer === undefined) {
    throw new Error(`${spec.file}: ${spec.exportName} has no initializer`);
  }
  return initializer;
}

/**
 * Enumerate every canon entry across the five registries, in authoring order.
 * Authoring order is page order everywhere in the canons, so this listing and
 * the rendered documents agree on sequence by construction.
 */
export function registryEntries(
  project: Project,
  root: string,
): CanonEntryRef[] {
  const entries: CanonEntryRef[] = [];
  for (const spec of PROSE_REGISTRIES) {
    const source = project.getSourceFileOrThrow(join(root, spec.file));
    const initializer = registryInitializer(source, spec);
    if (spec.keyField === "key") {
      collectKeyedEntries(spec, initializer, entries);
    } else {
      collectArrayEntries(spec, initializer, 0, undefined, entries);
    }
  }
  return entries;
}

/**
 * Resolve a lookup query to entries, most exact tier first: exact id, then
 * exact slug, then case-insensitive substring over ids, slugs, and titles.
 * A tier that matches wins outright, so `proof` finds the feature node while
 * `Proof` finds the glossary term.
 */
export function findEntries(
  all: readonly CanonEntryRef[],
  query: string,
): CanonEntryRef[] {
  const exact = all.filter((entry) => entry.id === query);
  if (exact.length > 0) return exact;
  const slug = slugify(query);
  const bySlug = all.filter((entry) => entry.slug === slug);
  if (bySlug.length > 0) return bySlug;
  const needle = query.toLowerCase();
  return all.filter(
    (entry) =>
      entry.id.toLowerCase().includes(needle) ||
      entry.slug.includes(slug) ||
      entry.title.toLowerCase().includes(needle),
  );
}

/** Step one path segment into an object or array literal. */
function stepInto(container: Node, segment: string): Node | undefined {
  const unwrapped = Node.isExpression(container)
    ? unwrapExpression(container)
    : container;
  if (/^\d+$/.test(segment) && Node.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.getElements()[Number(segment)];
  }
  if (Node.isObjectLiteralExpression(unwrapped)) {
    const property = unwrapped.getProperty(segment);
    if (property === undefined || !Node.isPropertyAssignment(property)) {
      return undefined;
    }
    return property.getInitializer();
  }
  return undefined;
}

/**
 * Resolve a dotted field path (`plain.what`, `retired.0.phrase`) to the value
 * literal it names inside an entry, classified by what the editor may do with
 * it. Returns undefined when the path names nothing — an absent optional
 * field, or a path from a stale client.
 */
export function fieldTarget(
  entry: CanonEntryRef,
  path: string,
): FieldTarget | undefined {
  let current: Node = entry.node;
  for (const segment of path.split(".")) {
    const next = stepInto(current, segment);
    if (next === undefined) return undefined;
    current = next;
  }
  const value = Node.isExpression(current)
    ? unwrapExpression(current)
    : current;
  return {
    path,
    kind: classifyValue(value),
    line: value.getStartLineNumber(),
    node: value,
  };
}

/** Append one leaf to the inventory being built. */
function pushLeaf(into: FieldLeaf[], path: string, node: Node): void {
  into.push({
    path,
    kind: classifyValue(node),
    line: node.getStartLineNumber(),
  });
}

/** Walk an entry's properties into dotted leaves, skipping child entries. */
function collectLeaves(
  spec: RegistrySpec,
  container: ObjectLiteralExpression,
  prefix: string,
  into: FieldLeaf[],
): void {
  for (const property of container.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const name = propertyKeyText(property);
    if (prefix === "" && name === spec.childField) continue;
    const value = property.getInitializer();
    if (value === undefined) continue;
    const unwrapped = unwrapExpression(value);
    const path = prefix === "" ? name : `${prefix}.${name}`;
    if (Node.isObjectLiteralExpression(unwrapped)) {
      collectLeaves(spec, unwrapped, path, into);
      continue;
    }
    if (Node.isArrayLiteralExpression(unwrapped)) {
      const elements = unwrapped.getElements();
      const objects = elements.filter((element) =>
        Node.isObjectLiteralExpression(unwrapExpression(element))
      );
      if (objects.length > 0) {
        elements.forEach((element, index) => {
          const item = unwrapExpression(element);
          if (Node.isObjectLiteralExpression(item)) {
            collectLeaves(spec, item, `${path}.${index}`, into);
          } else {
            pushLeaf(into, `${path}.${index}`, item);
          }
        });
        continue;
      }
    }
    pushLeaf(into, path, unwrapped);
  }
}

/**
 * The complete field inventory of one entry as dotted leaf paths, in source
 * order — every prose string, list, and locked derived literal, with nested
 * accounts (`plain.*`, `upheld.*`, `retired.*`) flattened. Child entries are
 * excluded; they are entries of their own.
 */
export function fieldLeaves(entry: CanonEntryRef): FieldLeaf[] {
  const spec = PROSE_REGISTRIES.find((item) => item.name === entry.registry);
  if (spec === undefined) {
    throw new Error(`unknown registry ${entry.registry}`);
  }
  const leaves: FieldLeaf[] = [];
  collectLeaves(spec, entry.node, "", leaves);
  return leaves;
}
