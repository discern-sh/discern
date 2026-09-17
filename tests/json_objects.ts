/** Shared walker for tests that inspect every object in a parsed document. */

export interface LocatedObject {
  readonly path: string;
  readonly value: Record<string, unknown>;
}

/** Every object in a parsed JSON or YAML value, including objects nested in arrays, with a stable diagnostic path. */
export function jsonObjects(value: unknown, path = "$"): LocatedObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      jsonObjects(item, `${path}[${index}]`)
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  return [
    { path, value: record },
    ...Object.entries(record).flatMap(([key, item]) =>
      jsonObjects(item, `${path}.${key}`)
    ),
  ];
}
