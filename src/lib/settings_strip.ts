/**
 * Reverse the co-owned-settings merge — the uninstall counterpart to
 * `settings_merge.ts`.
 *
 * `setup`/`refresh` MERGE discern's contribution into a project's JSON settings
 * files (a provider MCP entry, the session hook groups, discern's permission
 * defaults) additively, leaving the user's own keys untouched. Uninstall must
 * take exactly that contribution back out and leave everything else byte-for-byte
 * as the user had it. This module is that pure strip: given a co-owned file's
 * text (and, when the file is a hooks target, the provider's seed template that
 * says what discern put there), it returns the file with discern's entries
 * removed — or `null` when nothing the user owns is left, so the caller deletes
 * the file discern created outright.
 *
 * It reverses only what a writer here added: the `mcpServers.discern` entry, the
 * `enabledMcpjsonServers` pre-approval, hook groups that invoke the discern
 * binary, and the template's own permission/scalar seeds. A hook group with no
 * discern command, a permission the user added, a server the user registered —
 * none are ever matched, so a strip can only ever shrink discern's footprint.
 */

import { DISCERN_MCP_SERVER } from "./providers.ts";

/** A JSON object map. */
type JsonObject = Record<string, unknown>;

/** True for a non-null, non-array object. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Order-insensitive deep equality via canonical JSON. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (isObject(value)) {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

/** Compare JSON-compatible values after recursively sorting object keys. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * Every command string a hook group carries — whether nested under
 * `hooks[].command`/`hooks[].bash` or at the group level (`command`/`bash`) —
 * covering the shapes discern's providers write across vendors (Claude's nested
 * `command`, Cursor's group-level `command`, Copilot's group-level `bash`).
 */
function hookGroupCommands(group: unknown): string[] {
  const out: string[] = [];
  if (!isObject(group)) {
    return out;
  }
  const pushIfString = (v: unknown): void => {
    if (typeof v === "string") {
      out.push(v);
    }
  };
  pushIfString(group.command);
  pushIfString(group.bash);
  if (Array.isArray(group.hooks)) {
    for (const hook of group.hooks) {
      if (isObject(hook)) {
        pushIfString(hook.command);
        pushIfString(hook.bash);
      }
    }
  }
  return out;
}

/** A command that invokes the discern binary (`discern …`), so word-boundary
 * safe: a user command like `mydiscern` or `discernment` is never matched. */
function isDiscernCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === "discern" || trimmed.startsWith("discern ");
}

/**
 * A hook group discern installed: it carries at least one command and EVERY
 * command invokes the discern binary. A user's own group (no discern command, or
 * a mix) is left in place, so the strip only ever removes discern's own wiring.
 */
function isDiscernHookGroup(group: unknown): boolean {
  const commands = hookGroupCommands(group);
  return commands.length > 0 && commands.every(isDiscernCommand);
}

/** Drop a key and return whether the container is now empty. */
function deleteIfPresent(obj: JsonObject, key: string): void {
  if (Object.hasOwn(obj, key)) {
    delete obj[key];
  }
}

/** Remove discern's session hook groups from a `hooks` object in place, pruning
 * events (and the `hooks` object) that empty out. */
function stripHookGroups(root: JsonObject): void {
  const hooks = root.hooks;
  if (!isObject(hooks)) {
    return;
  }
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      continue;
    }
    const kept = groups.filter((group) => !isDiscernHookGroup(group));
    if (kept.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = kept;
    }
  }
  if (Object.keys(hooks).length === 0) {
    deleteIfPresent(root, "hooks");
  }
}

/** Remove `value` from a named string/JSON array under `obj[key]`, pruning the
 * key when the array empties. */
function stripArrayValue(obj: JsonObject, key: string, value: unknown): void {
  const arr = obj[key];
  if (!Array.isArray(arr)) {
    return;
  }
  const wanted = JSON.stringify(canonical(value));
  const kept = arr.filter((v) => JSON.stringify(canonical(v)) !== wanted);
  if (kept.length === 0) {
    delete obj[key];
  } else {
    obj[key] = kept;
  }
}

/** Apply the discern hooks-seed template's own contribution in reverse: remove
 * the permission values it unions in, and any set-if-absent scalar/object leaf
 * still equal to what the template seeded. `hooks` is handled separately (by
 * discern-command detection, which covers template and drift alike). */
function stripTemplateContribution(
  root: JsonObject,
  templateText: string,
): void {
  let template: unknown;
  try {
    template = JSON.parse(templateText);
  } catch {
    // discern-best-effort: settings-template-decode-fallback
    return;
  }
  if (!isObject(template)) {
    return;
  }
  for (const [key, value] of Object.entries(template)) {
    if (key === "hooks") {
      continue; // discern hook groups are removed by isDiscernHookGroup
    }
    if (key === "permissions" && isObject(value)) {
      const permissions = root.permissions;
      if (!isObject(permissions)) {
        continue;
      }
      for (const [permKey, permValues] of Object.entries(value)) {
        if (Array.isArray(permValues)) {
          for (const v of permValues) {
            stripArrayValue(permissions, permKey, v);
          }
        }
      }
      if (Object.keys(permissions).length === 0) {
        deleteIfPresent(root, "permissions");
      }
      continue;
    }
    // A set-if-absent leaf (e.g. `hooksConfig`, `version`, `$schema`): discern
    // wrote it only when absent, so an unchanged value is discern's to remove; a
    // value the user has since changed is left alone.
    if (Object.hasOwn(root, key) && deepEqual(root[key], value)) {
      delete root[key];
    }
  }
}

/** What discern may have written into one co-owned JSON settings file. */
export interface JsonStripOptions {
  /** True when a provider wired its MCP server into THIS file. */
  readonly hasMcp: boolean;
  /** The provider hooks seed template's text, when this file is a hooks target —
   * the source of truth for the permission/scalar seeds to reverse. */
  readonly hooksTemplateText?: string | undefined;
}

/**
 * Strip discern's contribution from a co-owned JSON settings file's text.
 * Returns the new canonical 2-space JSON (matching what the merge writes), or
 * `null` when the file is left with no user content — the signal to delete a
 * file discern created outright. Malformed JSON is returned unchanged (never
 * deleted): an unreadable user file is not discern's to remove.
 */
export function stripDiscernFromJsonSettings(
  existingText: string,
  options: JsonStripOptions,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText);
  } catch {
    return existingText;
  }
  if (!isObject(parsed)) {
    return existingText;
  }
  const root: JsonObject = { ...parsed };

  // The MCP server entry and its Claude pre-approval, written by the provider
  // registry's MCP wirers (not from a template).
  const servers = root.mcpServers;
  if (isObject(servers)) {
    deleteIfPresent(servers, DISCERN_MCP_SERVER.name);
    if (Object.keys(servers).length === 0) {
      deleteIfPresent(root, "mcpServers");
    }
  }
  stripArrayValue(root, "enabledMcpjsonServers", DISCERN_MCP_SERVER.name);

  // The session hook groups (present on every hooks target).
  stripHookGroups(root);

  // The hooks seed template's permission/scalar contribution.
  if (options.hooksTemplateText !== undefined) {
    stripTemplateContribution(root, options.hooksTemplateText);
  }

  if (Object.keys(root).length === 0) {
    return null;
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}
