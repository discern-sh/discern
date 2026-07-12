/**
 * Focused unit guards for the pure strip helpers behind `discern uninstall` — the
 * tricky co-owned-file reversals the e2e round-trip exercises end-to-end, pinned
 * here at the edge cases that matter: a discern block wedged BETWEEN user rules, a
 * user hook group that must survive alongside discern's, and the Codex
 * environment shell that discern created versus one the app owns.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { removeGitignoreBlock } from "../src/commands/uninstall.ts";
import { stripDiscernFromJsonSettings } from "../src/lib/settings_strip.ts";
import { stripDiscernFromCodexEnv } from "../src/lib/providers.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";

const UNINSTALL_SRC = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "src",
  "commands",
  "uninstall.ts",
);

const BEGIN = "# --- discern ---";
const END = "# --- /discern ---";

Deno.test("removeGitignoreBlock keeps the user's rules on both sides of the block", () => {
  const text = [
    "node_modules/",
    "",
    BEGIN,
    "/CLAUDE.md",
    "/.claude/*",
    END,
    "",
    "*.log",
    "",
  ].join("\n");
  const out = removeGitignoreBlock(text);
  assert(out !== null);
  assert(out.includes("node_modules/"));
  assert(out.includes("*.log"));
  assert(!out.includes("# --- discern ---"));
  assert(!out.includes("/CLAUDE.md"));
});

Deno.test("removeGitignoreBlock deletes a file that held only the block", () => {
  const text = [BEGIN, "/AGENTS.md", "/.agents/skills/", END, ""].join("\n");
  assertEquals(removeGitignoreBlock(text), null);
});

Deno.test("removeGitignoreBlock leaves a file with no discern block untouched", () => {
  const text = "node_modules/\ndist/\n";
  assertEquals(removeGitignoreBlock(text), text);
});

Deno.test("removeGitignoreBlock handles an unterminated block by removing to EOF", () => {
  const text = ["dist/", "", BEGIN, "/CLAUDE.md"].join("\n");
  const out = removeGitignoreBlock(text);
  assert(out !== null);
  assert(out.includes("dist/"));
  assert(!out.includes("CLAUDE.md"));
});

Deno.test("stripDiscernFromJsonSettings keeps user hooks and permissions, removes discern's", () => {
  const existing = JSON.stringify(
    {
      permissions: { deny: ["Read(secret)", "Read(./.env)"] },
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo mine" }] },
          { hooks: [{ type: "command", command: "discern worktree ensure" }] },
        ],
        WorktreeCreate: [
          { hooks: [{ type: "command", command: "discern worktree create" }] },
        ],
      },
      mcpServers: {
        other: { type: "stdio", command: "x", args: [] },
        discern: { type: "stdio", command: "discern", args: ["mcp"] },
      },
      enabledMcpjsonServers: ["discern"],
    },
    null,
    2,
  );
  const template = JSON.stringify({
    permissions: { deny: ["Read(./.env)"] },
    hooks: {
      SessionStart: [{ hooks: [{ command: "discern worktree ensure" }] }],
    },
  });

  const out = stripDiscernFromJsonSettings(existing, {
    hasMcp: true,
    hooksTemplateText: template,
  });
  assert(out !== null);
  const parsed = JSON.parse(out);
  // The user's own hook group and deny rule survive.
  assertEquals(parsed.hooks.SessionStart.length, 1);
  assertEquals(parsed.hooks.SessionStart[0].hooks[0].command, "echo mine");
  assertEquals(parsed.permissions.deny, ["Read(secret)"]);
  // The user's own MCP server survives; discern's is gone.
  assertEquals(Object.keys(parsed.mcpServers), ["other"]);
  // Discern's WorktreeCreate event, enabledMcpjsonServers, and server are gone.
  assert(!("WorktreeCreate" in parsed.hooks));
  assert(!("enabledMcpjsonServers" in parsed));
});

Deno.test("stripDiscernFromJsonSettings deletes a file that was purely discern's", () => {
  const existing = JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{ type: "command", bash: "discern worktree ensure" }],
    },
  });
  const template = JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{ type: "command", bash: "discern worktree ensure" }],
    },
  });
  assertEquals(
    stripDiscernFromJsonSettings(existing, {
      hasMcp: false,
      hooksTemplateText: template,
    }),
    null,
  );
});

Deno.test("stripDiscernFromCodexEnv deletes a discern-created shell, keeps an app-owned file", () => {
  const discernShell = [
    "version = 1",
    'name = "Discern"',
    "",
    "[setup]",
    'script = "discern worktree ensure"',
    "",
    "[cleanup]",
    'script = "discern worktree teardown"',
    "",
  ].join("\n");
  assertEquals(stripDiscernFromCodexEnv(discernShell), null);

  const appOwned = [
    "version = 2",
    'name = "My Env"',
    "",
    "[setup]",
    'script = "discern worktree ensure"',
    "",
    "[[actions]]",
    'run = "npm ci"',
    "",
  ].join("\n");
  const out = stripDiscernFromCodexEnv(appOwned);
  assert(out !== null);
  assert(
    !out.includes("discern worktree ensure"),
    "discern's script is stripped",
  );
  assert(out.includes('name = "My Env"'), "the app's config is kept");
  assert(out.includes("npm ci"), "the app's actions are kept");
});

Deno.test("TomlEditor.deleteRootKey removes a pre-section key and leaves the rest", () => {
  const editor = new TomlEditor(
    ["version = 1", 'name = "Discern"', "", "[setup]", 'script = "x"', ""].join(
      "\n",
    ),
  );
  assertEquals(editor.deleteRootKey("version"), true);
  const out = editor.toString();
  assert(!out.includes("version = 1"));
  assert(out.includes('name = "Discern"'));
  assert(out.includes("[setup]"));
  // Absent key is a no-op returning false.
  assertEquals(editor.deleteRootKey("missing"), false);
});

// ── Class guard: every UninstallPlan field is consumed (B52) ─────────────────
//
// The class: a plan field computed and never read. The plan/apply split
// (ADR 0027) only holds if the executor and renderer honour every plan fact —
// `templatesAvailable` was computed and consumed nowhere, so an uninstall left
// template-seeded settings orphaned in silence. This structural guard reads the
// `UninstallPlan` interface from source and asserts each declared field is
// referenced by one of the functions that ACT on a built plan; a new
// consumer-less field fails the gate. Driven off the interface itself (not a
// hand-copied field list), so a new field auto-enrols.

/** Extract a `{ … }`-delimited block starting at the first `{` after `marker`. */
function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert(start !== -1, `could not find ${marker} in uninstall.ts`);
  const open = source.indexOf("{", start);
  assert(open !== -1, `no opening brace after ${marker}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block after ${marker}`);
}

/** The top-level field names declared in the `UninstallPlan` interface body. */
function uninstallPlanFields(source: string): string[] {
  const body = blockAfter(source, "interface UninstallPlan");
  const fields: string[] = [];
  let depth = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    // Only inspect lines at the interface's own top level (skip nested shapes).
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (
      depth === 0 && !line.startsWith("*") && !line.startsWith("/") &&
      !line.startsWith("//")
    ) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
      if (m && m[1] !== undefined) {
        fields.push(m[1]);
      }
    }
    depth += opens - closes;
  }
  return fields;
}

Deno.test("every UninstallPlan field is read by a plan-consuming function (no orphan facts)", async () => {
  const source = await Deno.readTextFile(UNINSTALL_SRC);
  const fields = uninstallPlanFields(source);
  // Sanity: the parser found the real fields, including the one B52 was about.
  assert(
    fields.length >= 4,
    `parsed too few plan fields: ${fields.join(", ")}`,
  );
  assert(
    fields.includes("templatesAvailable"),
    "expected templatesAvailable among the parsed fields",
  );

  // The functions that act on an already-built plan. A field read by NONE of
  // them is computed for nothing — the exact defect B52 was.
  const consumers = [
    blockAfter(source, "function planData"),
    blockAfter(source, "function renderPlan"),
    blockAfter(source, "function applyUninstallPlan"),
  ].join("\n");

  const orphans = fields.filter((f) => !consumers.includes(`.${f}`));
  assertEquals(
    orphans,
    [],
    `UninstallPlan fields computed but never consumed: ${
      orphans.join(", ")
    }. ` +
      `Every plan fact must be read by planData, renderPlan, or ` +
      `applyUninstallPlan — surface it or drop it.`,
  );
});
