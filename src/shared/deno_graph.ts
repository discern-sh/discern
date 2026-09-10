/** The shared decoder for Deno's resolved module graph metadata. */

/** Whether decoded JSON is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface DenoInfoResolution {
  readonly specifier: string;
}

interface DenoInfoDependency {
  readonly specifier: string;
  readonly code?: DenoInfoResolution;
  readonly type?: DenoInfoResolution;
}

export interface DenoInfoModule {
  readonly specifier: string;
  readonly local?: string;
  readonly mediaType?: string;
  readonly dependencies: readonly DenoInfoDependency[];
}

export interface DenoInfoNpmPackage {
  readonly name: string;
  readonly localPath: string;
}

export interface DenoInfoGraph {
  readonly modules: readonly DenoInfoModule[];
  readonly redirects: Readonly<Record<string, string>>;
  readonly npmPackages: readonly DenoInfoNpmPackage[];
}

/** Read one required non-empty string from decoded metadata. */
function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

/** Decode one optional Deno module-graph resolution. */
function decodeResolution(
  value: unknown,
  context: string,
): DenoInfoResolution | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${context} must be an object`);
  if (!("specifier" in value)) {
    const error = value.error;
    if (typeof error === "string" && error.length > 0) return undefined;
  }
  return { specifier: requiredString(value, "specifier", context) };
}

/** Decode the dependency edges needed by the TypeScript resolution host. */
function decodeDependencies(
  value: unknown,
  context: string,
): DenoInfoDependency[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${context} must be an array`);
  return value.map((item, index) => {
    const itemContext = `${context}[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${itemContext} must be an object`);
    }
    const code = decodeResolution(item.code, `${itemContext}.code`);
    const type = decodeResolution(item.type, `${itemContext}.type`);
    return {
      specifier: requiredString(item, "specifier", itemContext),
      ...(code === undefined ? {} : { code }),
      ...(type === undefined ? {} : { type }),
    };
  });
}

/** Decode the stable subset of `deno info --json` used by the checker. */
export function decodeDenoInfoGraph(value: unknown): DenoInfoGraph {
  if (!isRecord(value)) {
    throw new TypeError("deno info output must be an object");
  }
  if (!Array.isArray(value.modules)) {
    throw new TypeError("deno info output.modules must be an array");
  }
  const modules = value.modules.map((item, index): DenoInfoModule => {
    const context = `deno info output.modules[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${context} must be an object`);
    const local = item.local;
    const mediaType = item.mediaType;
    if (local !== undefined && local !== null && typeof local !== "string") {
      throw new TypeError(`${context}.local must be a string or null`);
    }
    if (
      mediaType !== undefined && mediaType !== null &&
      typeof mediaType !== "string"
    ) {
      throw new TypeError(`${context}.mediaType must be a string or null`);
    }
    return {
      specifier: requiredString(item, "specifier", context),
      ...(typeof local === "string" ? { local } : {}),
      ...(typeof mediaType === "string" ? { mediaType } : {}),
      dependencies: decodeDependencies(
        item.dependencies,
        `${context}.dependencies`,
      ),
    };
  });

  if (!isRecord(value.redirects)) {
    throw new TypeError("deno info output.redirects must be an object");
  }
  const redirects: Record<string, string> = {};
  for (const [from, to] of Object.entries(value.redirects)) {
    if (typeof to !== "string") {
      throw new TypeError(`deno info redirect '${from}' must name a string`);
    }
    redirects[from] = to;
  }

  if (!isRecord(value.npmPackages)) {
    throw new TypeError("deno info output.npmPackages must be an object");
  }
  const npmPackages: DenoInfoNpmPackage[] = [];
  for (const [id, item] of Object.entries(value.npmPackages)) {
    if (!isRecord(item)) {
      throw new TypeError(`deno info npm package '${id}' must be an object`);
    }
    npmPackages.push({
      name: requiredString(item, "name", `deno info npm package '${id}'`),
      localPath: requiredString(
        item,
        "localPath",
        `deno info npm package '${id}'`,
      ),
    });
  }
  return { modules, redirects, npmPackages };
}
