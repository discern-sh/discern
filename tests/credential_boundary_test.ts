/**
 * The credential boundary, held structurally. discern is not a vault,
 * issuer, or source of credential authority, so the shipped program reads
 * no credential-shaped environment variable, declares no credential-shaped
 * configuration key, and opens no well-known credential store.
 *
 * Three chokepoints, each the single authority for its surface: the shipped
 * module graph for named environment reads and file paths, and the config
 * schema for keys. Every host variable the program reads by name is
 * enumerated here with its reason, so a new read enrols deliberately and
 * the credential test applies to it. Whole-environment inheritance for
 * configured commands stays outside this boundary: those commands keep
 * their own capabilities.
 *
 * Guards: boundary:credential-boundary
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { configSchema } from "../src/shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLE_NAMES } from "../src/shared/environment_variables.ts";
import { shippedModuleGraph } from "./module_graph.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { schemaKeys } from "./schema_keys.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Host variables the program reads by name, and why each is not a secret. */
const HOST_ENVIRONMENT_READS: Readonly<Record<string, string>> = {
  CI: "hosted-runner detection",
  EDITOR: "the operator's editor for interactive edits",
  GIT_BIN: "an alternative Git executable",
  GIT_INDEX_FILE:
    "reject an alternate Git index when freezing the real checkout state",
  HOME: "the home directory for host configuration paths",
  PAGER: "the operator's pager for long output",
  PATH: "executable lookup",
  PATHEXT: "Windows executable extensions",
  SHELL: "the operator's shell for spawned commands",
  VISUAL: "the operator's visual editor",
};

const CREDENTIAL_NAME =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|API_?KEY|PRIVATE_?KEY|AUTH|BEARER)(?:_|$)/i;

const CREDENTIAL_STORE =
  /\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.aws\/credentials|\.docker\/config\.json|\.ssh\/id_|keychain|find-generic-password/i;

const NAMED_ENV_READ = /\benv\.get\(\s*"([^"]+)"\s*\)/g;

/** The environment names a module reads by string literal. */
export function namedEnvironmentReads(text: string): string[] {
  return [...text.matchAll(NAMED_ENV_READ)].map((match) => match[1] ?? "");
}

const graph = await shippedModuleGraph(REPO_ROOT, "src/main.ts");
const SHIPPED_MODULES = await structuralGuardScope({
  guard: "tests/credential_boundary_test.ts#shipped-credential-surface",
  universe: {
    kind: "specialized",
    name: "shipped-credential-source",
    extensions: [".ts", ".js", ".json"],
    reason:
      "Deno's shipped graph includes executable JavaScript and imported JSON outside the authored-TypeScript universe.",
  },
  narrow: {
    reason:
      "Only repository-local modules resolved from src/main.ts can read the environment or open a file in the shipped program.",
    include: (path) => graph.modules.has(path),
  },
});

Deno.test("the shipped program reads no credential-shaped environment variable, and every host read is enumerated", async () => {
  assert(SHIPPED_MODULES.length > 20, "suspiciously small shipped graph");
  const registered = new Set<string>(DISCERN_ENVIRONMENT_VARIABLE_NAMES);
  const failures: string[] = [];
  for (const rel of SHIPPED_MODULES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const name of namedEnvironmentReads(text)) {
      if (CREDENTIAL_NAME.test(name)) {
        failures.push(`${rel} reads credential-shaped ${name}`);
      } else if (
        !registered.has(name) && !Object.hasOwn(HOST_ENVIRONMENT_READS, name)
      ) {
        failures.push(
          `${rel} reads ${name}, which is neither a registered DISCERN_* variable nor an enumerated host read`,
        );
      }
    }
  }
  for (const name of Object.keys(HOST_ENVIRONMENT_READS)) {
    if (CREDENTIAL_NAME.test(name)) {
      failures.push(`the host-read allowlist names credential-shaped ${name}`);
    }
  }
  assertEquals(failures, [], failures.join("\n"));
});

Deno.test("the shipped program opens no well-known credential store", async () => {
  const offenders: string[] = [];
  for (const rel of SHIPPED_MODULES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    const match = CREDENTIAL_STORE.exec(text);
    if (match !== null) offenders.push(`${rel} names ${match[0]}`);
  }
  assertEquals(offenders, [], offenders.join("\n"));
});

Deno.test("no configuration key is credential-shaped", () => {
  const keys = schemaKeys(configSchema, "discern.toml");
  assert(keys.length > 50, `suspiciously small config schema: ${keys.length}`);
  const offenders = keys
    .filter(({ key }) => CREDENTIAL_NAME.test(key))
    .map(({ path }) => path);
  assertEquals(
    offenders,
    [],
    `credential-shaped keys:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("control: the detectors fire on planted reads, stores, and keys", () => {
  assertEquals(
    namedEnvironmentReads(
      'const t = env.get("GITHUB_TOKEN"); Deno.env.get("HOME");',
    ),
    ["GITHUB_TOKEN", "HOME"],
  );
  assert(CREDENTIAL_NAME.test("GITHUB_TOKEN"));
  assert(CREDENTIAL_NAME.test("api_key"));
  assert(CREDENTIAL_NAME.test("npm_auth"));
  assert(!CREDENTIAL_NAME.test("PATHEXT"));
  assert(!CREDENTIAL_NAME.test("author"));
  assert(CREDENTIAL_STORE.test('readTextFile(join(home, ".netrc"))'));
  assert(!CREDENTIAL_STORE.test('readTextFile(join(root, "discern.toml"))'));
});
