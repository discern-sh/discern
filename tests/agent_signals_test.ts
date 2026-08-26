/**
 * Advisory agent-signal coverage: the external marker catalogue, all-match
 * semantics, privacy boundary, MCP protocol bridge, and native-provider tie.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  AGENT_CATALOGUE,
  AGENT_NAMES,
  AGENT_SIGNAL_SOURCE_LIFETIMES,
  AGENT_SIGNAL_SOURCES,
  type AgentIdentity,
  agentLabel,
} from "../src/shared/agent_catalogue.ts";
import {
  classifyMcpClient,
  effectiveAgentSignals,
} from "../src/engine/logbook/agent_identity.ts";
import {
  detectAgentSignals,
  MCP_CLIENT_INFO_FIELD_LIMIT,
  MCP_CLIENT_INFO_META_KEY,
  parseMcpClientInfo,
  resolveMcpClientInfo,
} from "../src/engine/logbook/agent_signals.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { fakeEnv } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const AGENT_SIGNAL_SOURCE_FILES = await structuralGuardScope({
  guard: "tests/agent_signals_test.ts#production-agent-signal-boundaries",
  universe: "authored-ts",
  narrow: {
    reason:
      "Agent signal recording and reading are production boundaries implemented beneath src; tests exercise their controls.",
    include: (path) => path.startsWith("src/"),
  },
});
const NO_HOST_MARKERS = (_path: string): Promise<boolean> =>
  Promise.resolve(false);

/** Architectural owners of the persisted identity field: its schema, the two
 * recorders, its vocabulary comment, and the one effective reader view. */
const RAW_IDENTITY_FIELD_OWNERS = new Set([
  "src/engine/logbook/agent_identity.ts",
  "src/engine/logbook/cli.ts",
  "src/engine/logbook/schema.ts",
  "src/engine/mcp/server.ts",
  "src/shared/agent_catalogue.ts",
]);

/** Parse one production module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Whether executable syntax imports the agent-signal detector module. */
function importsAgentSignalDetector(path: string, source: string): boolean {
  const parsed = parseModule(path, source);
  if (
    parsed.getImportDeclarations().some((declaration) =>
      declaration.getModuleSpecifierValue().endsWith("/agent_signals.ts")
    )
  ) return true;
  return parsed.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
      return false;
    }
    const target = call.getArguments()[0];
    return target !== undefined && Node.isStringLiteral(target) &&
      target.getLiteralValue().endsWith("/agent_signals.ts");
  });
}

/** Whether executable syntax reads the stored raw identity field. */
function readsRawIdentityField(path: string, source: string): boolean {
  const parsed = parseModule(path, source);
  if (
    parsed.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .some((access) => access.getName() === "agent_signals")
  ) return true;
  if (
    parsed.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
      .some((access) => {
        const key = access.getArgumentExpression();
        return key !== undefined && Node.isStringLiteral(key) &&
          key.getLiteralValue() === "agent_signals";
      })
  ) return true;
  return parsed.getDescendantsOfKind(SyntaxKind.BindingElement)
    .some((binding) => {
      const field = binding.getPropertyNameNode() ?? binding.getNameNode();
      return field.getText() === "agent_signals" ||
        Node.isStringLiteral(field) &&
          field.getLiteralValue() === "agent_signals";
    });
}

/** Production files that bypass the canonical effective identity view. */
function rawIdentityBypasses(
  sources: Iterable<readonly [string, string]>,
): string[] {
  const bypasses: string[] = [];
  for (const [path, source] of sources) {
    if (
      readsRawIdentityField(path, source) &&
      !RAW_IDENTITY_FIELD_OWNERS.has(path)
    ) {
      bypasses.push(path);
    }
  }
  return bypasses.sort();
}

interface EnvironmentCase {
  readonly agent: AgentIdentity;
  readonly env: Record<string, string>;
  readonly markers: string[];
}

const ENVIRONMENT_CASES: readonly EnvironmentCase[] = [
  { agent: "cursor", env: { CURSOR_AGENT: "1" }, markers: ["CURSOR_AGENT"] },
  { agent: "claude", env: { CLAUDECODE: "1" }, markers: ["CLAUDECODE"] },
  { agent: "replit", env: { REPL_ID: "1" }, markers: ["REPL_ID"] },
  { agent: "gemini", env: { GEMINI_CLI: "1" }, markers: ["GEMINI_CLI"] },
  {
    agent: "codex",
    env: { CODEX_THREAD_ID: "1" },
    markers: ["CODEX_THREAD_ID"],
  },
  {
    agent: "augment-cli",
    env: { AUGMENT_AGENT: "1" },
    markers: ["AUGMENT_AGENT"],
  },
  {
    agent: "opencode",
    env: { OPENCODE_CLIENT: "1" },
    markers: ["OPENCODE_CLIENT"],
  },
  {
    agent: "amp",
    env: { AMP_CURRENT_THREAD_ID: "1" },
    markers: ["AMP_CURRENT_THREAD_ID"],
  },
  {
    agent: "copilot",
    env: { COPILOT_CLI: "1" },
    markers: ["COPILOT_CLI"],
  },
  {
    agent: "antigravity",
    env: { ANTIGRAVITY_AGENT: "1" },
    markers: ["ANTIGRAVITY_AGENT"],
  },
  {
    agent: "pi",
    env: { PI_CODING_AGENT: "1" },
    markers: ["PI_CODING_AGENT"],
  },
  {
    agent: "kiro-cli",
    env: { KIRO_AGENT_PATH: "1" },
    markers: ["KIRO_AGENT_PATH"],
  },
];

Deno.test("agent catalogue: covers laravel/agent-detector's stated agents and derives the native provider set", () => {
  assertEquals(
    AGENT_CATALOGUE.map((identity) => identity.id),
    [
      "cursor",
      "claude",
      "cowork",
      "devin",
      "replit",
      "gemini",
      "codex",
      "v0",
      "augment-cli",
      "opencode",
      "amp",
      "copilot",
      "antigravity",
      "pi",
      "kiro-cli",
      "custom",
    ],
  );
  const nativeEntries = AGENT_CATALOGUE.filter((entry) =>
    "nativeName" in entry && "nativeOrder" in entry
  ).sort((a, b) => a.nativeOrder - b.nativeOrder);
  assertEquals(
    nativeEntries.map((entry) => entry.nativeOrder),
    nativeEntries.map((_entry, index) => index),
    "native provider order must be unique and contiguous",
  );
  assertEquals(
    [...AGENT_NAMES],
    nativeEntries.map((entry) => entry.nativeName),
    "AGENT_NAMES must remain a projection of the catalogue, never a second list",
  );
  for (const name of AGENT_NAMES) {
    const identity = AGENT_CATALOGUE.find((entry) =>
      "nativeName" in entry && entry.nativeName === name
    );
    assert(identity !== undefined, `${name}: missing catalogue identity`);
    assertEquals(
      PROVIDERS[name].label,
      identity.label,
      `${name}: provider label must come from the shared catalogue`,
    );
  }
});

Deno.test("agent catalogue: every source class carries a lifetime and every identity a label", () => {
  assertEquals(
    Object.keys(AGENT_SIGNAL_SOURCE_LIFETIMES).sort(),
    [...AGENT_SIGNAL_SOURCES].sort(),
    "the lifetime record must stay total over the source union",
  );
  for (const source of AGENT_SIGNAL_SOURCES) {
    const lifetime = AGENT_SIGNAL_SOURCE_LIFETIMES[source];
    assert(
      lifetime === "invocation" || lifetime === "ambient",
      `${source}: unclassified lifetime`,
    );
  }
  for (const identity of AGENT_CATALOGUE) {
    assertEquals(
      agentLabel(identity.id),
      identity.label,
      `${identity.id}: label lookup must come from the catalogue`,
    );
  }
  assertEquals(
    agentLabel("some-future-agent"),
    "some-future-agent",
    "an id this release doesn't know must fall back to itself, never throw",
  );
});

Deno.test("agent detection is imported only by the two logbook recording chokepoints", async () => {
  const consumers: string[] = [];
  for (const rel of AGENT_SIGNAL_SOURCE_FILES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (importsAgentSignalDetector(rel, source)) {
      consumers.push(rel);
    }
  }
  assertEquals(
    consumers.sort(),
    [
      "src/engine/logbook/cli.ts",
      "src/engine/mcp/server.ts",
    ],
    "agent detection must remain logbook-only and never steer product behaviour",
  );
});

Deno.test("agent-signal guards distinguish executable syntax from registry metadata", () => {
  const metadata = `const boundary = {
  path: "src/engine/logbook/agent_signals.ts",
  operation: "record agent_signals as advisory evidence",
};\n`;
  assertEquals(
    importsAgentSignalDetector("src/shared/registry.ts", metadata),
    false,
  );
  assertEquals(
    rawIdentityBypasses([["src/shared/registry.ts", metadata]]),
    [],
  );
  assertEquals(
    importsAgentSignalDetector(
      "src/engine/logbook/new_writer.ts",
      'import { detectAgentSignals } from "./agent_signals.ts";',
    ),
    true,
  );
});

Deno.test("stored identity evidence is read only through the canonical effective view", async () => {
  const sources: [string, string][] = [];
  for (const rel of AGENT_SIGNAL_SOURCE_FILES) {
    sources.push([
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ]);
  }
  assertEquals(
    rawIdentityBypasses(sources),
    [],
    "a production reader must call effectiveAgentSignals instead of reading " +
      "the release-time stored field",
  );
  assertEquals(
    rawIdentityBypasses([[
      "src/engine/logbook/unrelated_report.ts",
      "const { agent_signals: clues } = event.driver;",
    ]]),
    ["src/engine/logbook/unrelated_report.ts"],
    "an independently named future reader must auto-enrol in the guard",
  );
});

Deno.test("agent signals: every environment marker family identifies its catalogue agent", async () => {
  for (const testCase of ENVIRONMENT_CASES) {
    const signals = await detectAgentSignals({
      env: fakeEnv(testCase.env),
      pathExists: NO_HOST_MARKERS,
    });
    assertEquals(signals, [{
      agent: testCase.agent,
      source: "process-environment",
      markers: testCase.markers,
    }], `${testCase.agent}: environment marker mismatch`);
  }
});

Deno.test("agent signals: every declared environment marker auto-enrols in detection", async () => {
  for (const identity of AGENT_CATALOGUE) {
    if (!("environment" in identity)) {
      continue;
    }
    for (const rule of identity.environment) {
      for (const marker of rule.anyOf ?? []) {
        const required = "allOf" in rule ? rule.allOf : [];
        const env = Object.fromEntries(
          [...required, marker].map((name) => [name, "present"]),
        );
        const signals = await detectAgentSignals({
          env: fakeEnv(env),
          pathExists: NO_HOST_MARKERS,
        });
        const signal = signals.find((candidate) =>
          candidate.agent === identity.id &&
          candidate.source === "process-environment"
        );
        assert(signal !== undefined, `${identity.id}: ${marker} did not match`);
        assert(
          signal.markers.includes(marker),
          `${identity.id}: ${marker} was not retained by name`,
        );
      }
    }
  }
});

Deno.test("agent signals: Claude Cowork is a variant signal, not a simultaneous Claude env match", async () => {
  const signals = await detectAgentSignals({
    env: fakeEnv({
      CLAUDE_CODE: "1",
      CLAUDE_CODE_IS_COWORK: "1",
    }),
    pathExists: NO_HOST_MARKERS,
  });
  assertEquals(signals, [{
    agent: "cowork",
    source: "process-environment",
    markers: ["CLAUDE_CODE_IS_COWORK", "CLAUDE_CODE"],
  }]);
});

Deno.test("agent signals: AI_AGENT aliases identify Claude, v0, and Copilot", async () => {
  const cases = [
    { value: "claude-code/1.0", agent: "claude" },
    { value: "v0", agent: "v0" },
    { value: "github-copilot", agent: "copilot" },
    { value: "github-copilot-cli", agent: "copilot" },
  ] as const;
  for (const testCase of cases) {
    assertEquals(
      await detectAgentSignals({
        env: fakeEnv({ AI_AGENT: testCase.value }),
        pathExists: NO_HOST_MARKERS,
      }),
      [{
        agent: testCase.agent,
        source: "process-environment",
        markers: ["AI_AGENT"],
      }],
    );
  }
});

Deno.test("agent signals: an unknown AI_AGENT becomes a value-free custom signal", async () => {
  const secretValue = "private-agent-name-that-must-not-land";
  const signals = await detectAgentSignals({
    env: fakeEnv({ AI_AGENT: secretValue }),
    pathExists: NO_HOST_MARKERS,
  });
  assertEquals(signals, [{
    agent: "custom",
    source: "process-environment",
    markers: ["AI_AGENT"],
  }]);
  assert(
    !JSON.stringify(signals).includes(secretValue),
    "the AI_AGENT value must never be retained",
  );
  assertEquals(
    await detectAgentSignals({
      env: fakeEnv({ AI_AGENT: "   " }),
      pathExists: NO_HOST_MARKERS,
    }),
    [],
    "a whitespace-only declaration is not a signal",
  );
});

Deno.test("agent signals: all sources coexist and Devin stays visibly ambient", async () => {
  const signals = await detectAgentSignals({
    env: fakeEnv({
      CODEX_SANDBOX: "seatbelt",
      CODEX_THREAD_ID: "thread-secret",
    }),
    mcpClient: {
      name: "gemini-cli",
      title: "Gemini",
      version: "1.2.3",
    },
    pathExists: (path) => Promise.resolve(path === "/opt/.devin"),
  });
  assertEquals(signals, [
    {
      agent: "devin",
      source: "host-filesystem",
      markers: ["/opt/.devin"],
    },
    {
      agent: "gemini",
      source: "mcp-client",
      markers: ["clientInfo.name", "clientInfo.title"],
    },
    {
      agent: "codex",
      source: "process-environment",
      markers: ["CODEX_SANDBOX", "CODEX_THREAD_ID"],
    },
  ]);
  assert(
    !JSON.stringify(signals).includes("thread-secret"),
    "environment values must not enter any signal",
  );
});

Deno.test("agent signals: every catalogue MCP name auto-enrols at record time and historical read time", async () => {
  for (const identity of AGENT_CATALOGUE) {
    if (identity.id === "custom") {
      continue;
    }
    const names = new Set([
      identity.id,
      identity.label,
      ...("nativeName" in identity ? [identity.nativeName] : []),
      ...("mcpAliases" in identity ? identity.mcpAliases : []),
    ]);
    for (const name of names) {
      const client = { name, version: "1" };
      const classified = classifyMcpClient(client);
      assert(
        classified.some((signal) =>
          signal.agent === identity.id &&
          signal.markers.includes("clientInfo.name")
        ),
        `${identity.id}: catalogue MCP name ${name} did not classify`,
      );
      const recorded = await detectAgentSignals({
        env: fakeEnv(),
        mcpClient: client,
        pathExists: NO_HOST_MARKERS,
      });
      assert(
        recorded.some((signal) =>
          signal.agent === identity.id && signal.source === "mcp-client"
        ),
        `${identity.id}: catalogue MCP name ${name} missed record time`,
      );
      const historical = effectiveAgentSignals({
        driver: { mcp_client: client },
      });
      assert(
        historical.some((signal) =>
          signal.agent === identity.id && signal.source === "mcp-client"
        ),
        `${identity.id}: catalogue MCP name ${name} missed historical read time`,
      );
    }
  }

  assertEquals(
    await detectAgentSignals({
      env: fakeEnv(),
      mcpClient: {
        name: "generic-vscode-host",
        title: "GitHub Copilot",
        version: "1",
      },
      pathExists: NO_HOST_MARKERS,
    }),
    [{
      agent: "copilot",
      source: "mcp-client",
      markers: ["clientInfo.title"],
    }],
  );
});

Deno.test("effective identity: current MCP interpretation replaces stale derived evidence without losing independent sources", () => {
  const driver = {
    agent_signals: [
      {
        agent: "codex",
        source: "mcp-client" as const,
        markers: ["clientInfo.title"],
      },
      {
        agent: "cursor",
        source: "process-environment" as const,
        markers: ["CURSOR_AGENT"],
      },
      {
        agent: "cursor",
        source: "process-environment" as const,
        markers: ["AI_AGENT", "CURSOR_AGENT"],
      },
    ],
    mcp_client: { name: "cursor-vscode", version: "1" },
  };
  const before = structuredClone(driver);
  assertEquals(effectiveAgentSignals({ driver }), [
    {
      agent: "cursor",
      source: "process-environment",
      markers: ["CURSOR_AGENT", "AI_AGENT"],
    },
    {
      agent: "cursor",
      source: "mcp-client",
      markers: ["clientInfo.name"],
    },
  ]);
  assertEquals(
    driver,
    before,
    "the effective view must never mutate the event",
  );
});

Deno.test("effective identity: a writer's MCP signal remains when the current catalogue has no interpretation", () => {
  assertEquals(
    effectiveAgentSignals({
      driver: {
        agent_signals: [{
          agent: "future-agent",
          source: "mcp-client",
          markers: ["clientInfo.name"],
        }],
        mcp_client: { name: "future-client", version: "1" },
      },
    }),
    [{
      agent: "future-agent",
      source: "mcp-client",
      markers: ["clientInfo.name"],
    }],
  );
  assertEquals(
    effectiveAgentSignals({
      driver: {
        mcp_client: { name: "mystery-agent", version: "1" },
      },
    }),
    [],
  );
});

Deno.test("agent signals: Cursor's name-only MCP identifier classifies as Cursor", async () => {
  assertEquals(
    await detectAgentSignals({
      env: fakeEnv(),
      mcpClient: { name: "cursor-vscode", version: "1" },
      pathExists: NO_HOST_MARKERS,
    }),
    [{
      agent: "cursor",
      source: "mcp-client",
      markers: ["clientInfo.name"],
    }],
  );
});

Deno.test("MCP client info: request metadata wins, malformed metadata falls back, and raw fields are bounded", () => {
  const initialized = { name: "initialized-client", version: "1" };
  const request = {
    name: "codex-mcp-client",
    title: "Codex",
    version: "2",
  };
  assertEquals(
    resolveMcpClientInfo({ [MCP_CLIENT_INFO_META_KEY]: request }, initialized),
    request,
  );
  assertEquals(
    resolveMcpClientInfo(
      { [MCP_CLIENT_INFO_META_KEY]: { name: "missing-version" } },
      initialized,
    ),
    initialized,
  );

  const long = `x${"y".repeat(MCP_CLIENT_INFO_FIELD_LIMIT + 20)}`;
  const bounded = parseMcpClientInfo({
    name: ` ${long} `,
    title: long,
    version: long,
  });
  assert(bounded !== undefined);
  assertEquals(bounded.name.length, MCP_CLIENT_INFO_FIELD_LIMIT);
  assertEquals(bounded.title?.length, MCP_CLIENT_INFO_FIELD_LIMIT);
  assertEquals(bounded.version.length, MCP_CLIENT_INFO_FIELD_LIMIT);
  assertEquals(parseMcpClientInfo({ name: "client" }), undefined);
});

Deno.test("agent signals: denied environment reads remain failures", async () => {
  await assertRejects(
    () =>
      detectAgentSignals({
        env: {
          get: () => {
            throw new Error("denied environment read");
          },
        },
        pathExists: NO_HOST_MARKERS,
      }),
    Error,
    "denied environment read",
  );
});

Deno.test("agent signals: denied host-marker reads degrade to no evidence", async () => {
  assertEquals(
    await detectAgentSignals({
      env: fakeEnv({}),
      pathExists: () => Promise.reject(new Error("denied host read")),
    }),
    [],
  );
});
