/**
 * Advisory agent-signal coverage: the external marker catalogue, all-match
 * semantics, privacy boundary, MCP protocol bridge, and native-provider tie.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";
import {
  AGENT_CATALOGUE,
  AGENT_NAMES,
  AGENT_SIGNAL_SOURCE_LIFETIMES,
  AGENT_SIGNAL_SOURCES,
  type AgentIdentity,
  agentLabel,
} from "../src/shared/agent_catalogue.ts";
import {
  detectAgentSignals,
  MCP_CLIENT_INFO_FIELD_LIMIT,
  MCP_CLIENT_INFO_META_KEY,
  parseMcpClientInfo,
  resolveMcpClientInfo,
} from "../src/engine/logbook/agent_signals.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { fakeEnv } from "./helpers.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));
const NO_HOST_MARKERS = (_path: string): Promise<boolean> =>
  Promise.resolve(false);

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
  for await (
    const entry of walk(join(REPO, "src"), {
      includeDirs: false,
      exts: [".ts"],
    })
  ) {
    const source = await Deno.readTextFile(entry.path);
    if (/["'][^"'\n]*agent_signals\.ts["']/.test(source)) {
      consumers.push(relative(REPO, entry.path));
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

Deno.test("agent signals: MCP aliases cover every named catalogue identity and title can classify independently", async () => {
  for (const identity of AGENT_CATALOGUE) {
    if (identity.id === "custom") {
      continue;
    }
    const signals = await detectAgentSignals({
      env: fakeEnv(),
      mcpClient: { name: identity.id, version: "1" },
      pathExists: NO_HOST_MARKERS,
    });
    assert(
      signals.some((signal) =>
        signal.agent === identity.id && signal.source === "mcp-client" &&
        signal.markers.includes("clientInfo.name")
      ),
      `${identity.id}: canonical MCP name must classify through the catalogue`,
    );
    if ("mcpAliases" in identity) {
      for (const alias of identity.mcpAliases) {
        const aliased = await detectAgentSignals({
          env: fakeEnv(),
          mcpClient: { name: alias, version: "1" },
          pathExists: NO_HOST_MARKERS,
        });
        assert(
          aliased.some((signal) =>
            signal.agent === identity.id && signal.source === "mcp-client"
          ),
          `${identity.id}: MCP alias ${alias} did not classify`,
        );
      }
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

Deno.test("agent signals: denied environment and host reads degrade to no evidence", async () => {
  assertEquals(
    await detectAgentSignals({
      env: {
        get: () => {
          throw new Error("denied");
        },
      },
      pathExists: () => Promise.reject(new Error("denied")),
    }),
    [],
  );
});
