/**
 * Closed-set enrollment guard for every `DISCERN_*` environment contract.
 *
 * Runtime TypeScript consumers derive names from the registry. This guard
 * covers the layers that cannot import it: shell, YAML, TOML, Markdown command
 * examples, and external-process fixtures. It scans the Git-derived authored
 * text universe, excluding dated records and private planning notes, and checks
 * every environment-shaped use against the registry. Synthetic controls prove
 * a future name is detected through every supported carrier syntax.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  DISCERN_ENVIRONMENT_VARIABLE_NAMES,
  DISCERN_ENVIRONMENT_VARIABLES,
} from "../src/shared/environment_variables.ts";
import {
  AUTHORED_TEXT_FILES,
  isRepoMapPath,
  REPO_ROOT,
} from "./repo_authored_paths.ts";

const REGISTRY_REL = "src/shared/environment_variables.ts";
const ENVIRONMENT_NAME_SOURCE = String.raw`DISCERN_[A-Z][A-Z0-9_]*`;

/** True when a path can carry a current contract rather than historical text. */
function isCurrentContractPath(rel: string): boolean {
  return !isRepoMapPath(rel, "_adr") && !isRepoMapPath(rel, "_private");
}

/** Add every first capture from `pattern` to `names`. */
function collectCapturedNames(
  text: string,
  pattern: RegExp,
  names: Set<string>,
): void {
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
}

/** Environment names used through process, shell, config, or workflow syntax. */
function environmentNamesInText(rel: string, text: string): string[] {
  const names = new Set<string>();
  collectCapturedNames(
    text,
    new RegExp(
      String
        .raw`\b(?:Deno\.env|[A-Za-z0-9_]*env[A-Za-z0-9_]*)\.(?:get|has|set|delete)\(\s*["'\x60](${ENVIRONMENT_NAME_SOURCE})["'\x60]`,
      "gi",
    ),
    names,
  );
  collectCapturedNames(
    text,
    new RegExp(
      String
        .raw`\b[A-Za-z0-9_]*env[A-Za-z0-9_]*\.(${ENVIRONMENT_NAME_SOURCE})\b`,
      "gi",
    ),
    names,
  );
  collectCapturedNames(
    text,
    new RegExp(
      String
        .raw`\b[A-Za-z0-9_]*env[A-Za-z0-9_]*\[\s*["'](${ENVIRONMENT_NAME_SOURCE})["']\s*\]`,
      "gi",
    ),
    names,
  );
  collectCapturedNames(
    text,
    new RegExp(
      /\.[cm]?[jt]sx?$/.test(rel)
        ? String.raw`\$(${ENVIRONMENT_NAME_SOURCE})\b`
        : String.raw`\$(?:\{)?(${ENVIRONMENT_NAME_SOURCE})\b`,
      "g",
    ),
    names,
  );
  collectCapturedNames(
    text,
    new RegExp(
      String.raw`(?:^|[{,])\s*["']?(${ENVIRONMENT_NAME_SOURCE})["']?\s*:`,
      "gm",
    ),
    names,
  );

  if (!/\.[cm]?[jt]sx?$/.test(rel)) {
    collectCapturedNames(
      text,
      new RegExp(
        String.raw`(?:^|[;"'\x60\s])(${ENVIRONMENT_NAME_SOURCE})=`,
        "gm",
      ),
      names,
    );
    collectCapturedNames(
      text,
      new RegExp(
        String.raw`\bexport\s+(${ENVIRONMENT_NAME_SOURCE})(?:\s|$)`,
        "gm",
      ),
      names,
    );
  }

  for (const match of text.matchAll(/--allow-env=([A-Z0-9_,]+)/g)) {
    for (const name of (match[1] ?? "").split(",")) {
      if (new RegExp(`^${ENVIRONMENT_NAME_SOURCE}$`).test(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** Collapse one concrete resource handle variable onto the registered family. */
function canonicalEnvironmentName(name: string): string {
  return /^DISCERN_RESOURCE_[A-Z0-9_]+$/.test(name)
    ? DISCERN_ENVIRONMENT_VARIABLES.resource
    : name;
}

/** Registered environment names missing from or exceeded by `observed`. */
function environmentEnrollmentFailures(
  registered: readonly string[],
  observed: readonly string[],
): string[] {
  const registeredSet = new Set(registered);
  return observed
    .filter((name) => !registeredSet.has(canonicalEnvironmentName(name)))
    .map(
      (name) =>
        `${name}: used as an environment variable but absent from DISCERN_ENVIRONMENT_VARIABLES`,
    );
}

/** Read every current authored contract surface except the registry itself. */
async function currentContractTexts(): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const rel of AUTHORED_TEXT_FILES) {
    if (rel === REGISTRY_REL || !isCurrentContractPath(rel)) continue;
    texts.set(rel, await Deno.readTextFile(join(REPO_ROOT, rel)));
  }
  return texts;
}

Deno.test("the environment registry has unique, well-formed names", () => {
  const names = [...DISCERN_ENVIRONMENT_VARIABLE_NAMES];
  assertEquals(new Set(names).size, names.length);
  for (const name of names) {
    assert(
      /^DISCERN_[A-Z][A-Z0-9_]*(?:<NAME>)?$/.test(name),
      `${name}: environment names use uppercase DISCERN_* syntax`,
    );
  }
});

Deno.test("every current DISCERN_* environment use is registered", async () => {
  const observed = new Set<string>();
  for (const [rel, text] of await currentContractTexts()) {
    for (const name of environmentNamesInText(rel, text)) observed.add(name);
  }
  assertEquals(
    environmentEnrollmentFailures(
      DISCERN_ENVIRONMENT_VARIABLE_NAMES,
      [...observed].sort(),
    ),
    [],
  );
});

Deno.test("every registered environment member has a live carrier", async () => {
  const texts = await currentContractTexts();
  const observed = new Set<string>();
  const joined = [...texts.values()].join("\n");
  for (const [rel, text] of texts) {
    for (const name of environmentNamesInText(rel, text)) {
      observed.add(canonicalEnvironmentName(name));
    }
  }
  const missing = Object.entries(DISCERN_ENVIRONMENT_VARIABLES)
    .filter(([key, name]) =>
      !observed.has(name) &&
      !joined.includes(`DISCERN_ENVIRONMENT_VARIABLES.${key}`)
    )
    .map(([key, name]) => `${key}=${name}`);
  assertEquals(missing, []);
});

Deno.test("environment enrollment catches future carriers", () => {
  const future = "DISCERN_FUTURE_SWITCH";
  const fixtures: Array<[string, string]> = [
    ["future.ts", `Deno.env.get("${future}")`],
    ["future.ts", `envReader.set("${future}", "1")`],
    ["future.ts", `env.${future} = "1"`],
    ["future.ts", `env["${future}"] = "1"`],
    ["future.ts", `const options = { env: { ${future}: "1" } }`],
    ["future.json", `{"env":{"${future}":"1"}}`],
    ["future.ts", `const command = 'test "$${future}" = 1'`],
    ["future.sh", `${future}=1\nprintf '%s' "$${future}"`],
    ["future.sh", `export ${future}`],
    ["future.yml", `env:\n  ${future}: "1"`],
    ["future.md", `Run \`${future}=1 command\`.`],
    ["deno.json", `"task": "deno run --allow-env=${future} main.ts"`],
  ];
  for (const [rel, text] of fixtures) {
    assertEquals(
      environmentNamesInText(rel, text),
      [future],
      `${rel}: ${text}`,
    );
  }
  assertEquals(
    environmentEnrollmentFailures(DISCERN_ENVIRONMENT_VARIABLE_NAMES, [future]),
    [
      `${future}: used as an environment variable but absent from DISCERN_ENVIRONMENT_VARIABLES`,
    ],
  );
  assertEquals(
    environmentNamesInText(
      "future.ts",
      "const DISCERN_MARK = 'triangle'; console.log('DISCERN_METRIC x 1')",
    ),
    [],
  );
});
