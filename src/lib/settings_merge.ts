/**
 * Deep-merge of the kit's `.claude/settings.json` into a project's existing one.
 *
 * The kit must never clobber a user's Claude settings, so this is an additive,
 * idempotent merge with three special rules:
 *
 *   hooks.<Event>      arrays of hook-group objects. Append our groups, but skip
 *                      any group whose inner command string already exists, so
 *                      re-running `setup`/`upgrade` adds nothing twice.
 *   permissions.allow  arrays of permission strings. Union (dedup by value).
 *   permissions.deny
 *   everything else    set-if-absent: take ours only when the key is missing;
 *                      otherwise keep the user's value (recursing into objects).
 *
 * Inputs are parsed JSON values (`unknown`); the result is a plain object ready
 * to be written back as 2-space JSON.
 */

/** A JSON object map. */
type JsonObject = Record<string, unknown>;

/** True for a non-null, non-array object. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The events whose values are arrays of hook-group objects. */
const HOOK_EVENTS_KEY = "hooks";

/** The permission arrays that should union rather than set-if-absent. */
const PERMISSION_ARRAY_KEYS = ["allow", "deny", "ask"];

/**
 * Extract every command string nested inside a hook group, e.g.
 * `{ hooks: [{ type: "command", command: "..." }] }`, to dedup groups by the
 * commands they contain so an identical hook is never appended twice.
 */
function commandsInGroup(group: unknown): string[] {
  if (!isObject(group) || !Array.isArray(group.hooks)) {
    return [];
  }
  const commands: string[] = [];
  for (const hook of group.hooks) {
    if (isObject(hook) && typeof hook.command === "string") {
      commands.push(hook.command);
    }
  }
  return commands;
}

/**
 * Merge one event's incoming hook groups into the existing ones, skipping any
 * incoming group all of whose commands already appear among the existing groups.
 */
function mergeHookEvent(existing: unknown, incoming: unknown[]): unknown[] {
  const base: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set<string>();
  for (const group of base) {
    for (const command of commandsInGroup(group)) {
      seen.add(command);
    }
  }
  for (const group of incoming) {
    const commands = commandsInGroup(group);
    // A group with at least one command is a duplicate iff every command in it
    // is already present. Groups carrying no command string are always appended.
    const isDuplicate = commands.length > 0 &&
      commands.every((c) => seen.has(c));
    if (isDuplicate) {
      continue;
    }
    base.push(group);
    for (const command of commands) {
      seen.add(command);
    }
  }
  return base;
}

/** Merge the `hooks` object: per-event array append-with-dedup. */
function mergeHooks(existing: unknown, incoming: JsonObject): JsonObject {
  const result: JsonObject = isObject(existing) ? { ...existing } : {};
  for (const [event, groups] of Object.entries(incoming)) {
    if (!Array.isArray(groups)) {
      // Defensive: a non-array hook event is set-if-absent like any scalar.
      if (!Object.hasOwn(result, event)) {
        result[event] = groups;
      }
      continue;
    }
    result[event] = mergeHookEvent(result[event], groups);
  }
  return result;
}

/** Union two permission arrays, preserving existing order then new values. */
function unionArray(existing: unknown, incoming: unknown[]): unknown[] {
  const base: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(base.map((v) => JSON.stringify(v)));
  for (const value of incoming) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      base.push(value);
      seen.add(key);
    }
  }
  return base;
}

/** Merge the `permissions` object: union the known arrays, recurse otherwise. */
function mergePermissions(existing: unknown, incoming: JsonObject): JsonObject {
  const result: JsonObject = isObject(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (PERMISSION_ARRAY_KEYS.includes(key) && Array.isArray(value)) {
      result[key] = unionArray(result[key], value);
      continue;
    }
    result[key] = mergeValue(result[key], value);
  }
  return result;
}

/**
 * Merge one value: objects recurse (set-if-absent on their leaves), arrays and
 * scalars are set-if-absent (keep the user's existing value when present).
 */
function mergeValue(existing: unknown, incoming: unknown): unknown {
  if (isObject(incoming)) {
    const base: JsonObject = isObject(existing) ? { ...existing } : {};
    for (const [key, value] of Object.entries(incoming)) {
      base[key] = mergeValue(base[key], value);
    }
    return base;
  }
  // Arrays (outside the special keys) and scalars: keep existing if present.
  return existing === undefined ? incoming : existing;
}

/**
 * A settings seed-merge strategy at the TEXT level: given the existing target
 * file's text (`undefined` when absent) and the token-substituted seed template
 * text, return the merged file's text to write. Text-level rather than
 * JSON-object-level on purpose — a hooks provider whose settings file is NOT JSON
 * (e.g. Codex's TOML, wired in a later plan) supplies its own strategy without the
 * scaffolding core assuming a format.
 */
export type SettingsSeedMerge = (
  existingText: string | undefined,
  incomingText: string,
) => string;

/** Parse settings JSON and identify which merge input is malformed on failure. */
function parseJsonSettingsText(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`malformed JSON in ${label} settings: ${detail}`);
  }
}

/**
 * The default seed-merge strategy: the JSON deep-merge ({@link mergeSettings})
 * lifted to text. Parses both sides as JSON, merges, and re-serializes to 2-space
 * JSON with a trailing newline — the exact bytes the Claude settings seed writes.
 * The strategy every JSON-settings hooks provider uses (an absent `mergeSeed` on its
 * `HooksIntegration` ⇒ this).
 */
export function mergeJsonSettingsText(
  existingText: string | undefined,
  incomingText: string,
): string {
  const existing: unknown = existingText === undefined
    ? {}
    : parseJsonSettingsText(existingText, "existing");
  const incoming: unknown = parseJsonSettingsText(incomingText, "incoming");
  return `${JSON.stringify(mergeSettings(existing, incoming), null, 2)}\n`;
}

/**
 * Like {@link mergeJsonSettingsText}, but additionally collapses hook-event groups
 * that are equal by canonical JSON — the strategy for a provider whose hook groups
 * carry the command at the GROUP level rather than nested under `hooks[].command`
 * (Cursor's `{ command }`, Copilot's `{ bash }`). The default
 * {@link mergeHookEvent} dedups only on a nested command string ({@link commandsInGroup}),
 * which such a group has none of — so a plain re-merge under `discern setup --force`
 * would append it again every time. Deferring to {@link mergeSettings} for the deep-merge
 * (so user keys, permission unions, and nested-command dedup all behave identically) and
 * then dropping any structurally-duplicate group makes the re-seed a stable no-op. The
 * dedup is shape-agnostic — it matches whole groups, so it bakes in no vendor key name
 * and only ever removes an EXACT repeat (the harmless case).
 */
export function mergeJsonSettingsDedupingGroups(
  existingText: string | undefined,
  incomingText: string,
): string {
  const existing: unknown = existingText === undefined
    ? {}
    : parseJsonSettingsText(existingText, "existing");
  const incoming: unknown = parseJsonSettingsText(incomingText, "incoming");
  const merged = mergeSettings(existing, incoming);
  const hooks = merged[HOOK_EVENTS_KEY];
  if (isObject(hooks)) {
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) {
        continue;
      }
      const seen = new Set<string>();
      hooks[event] = groups.filter((group) => {
        const key = JSON.stringify(group);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Deep-merge the kit's settings (`incoming`) into the user's (`existing`),
 * applying the hooks and permissions rules. Returns a new object; inputs are
 * not mutated. A missing/invalid `existing` is treated as an empty object.
 */
export function mergeSettings(
  existing: unknown,
  incoming: unknown,
): JsonObject {
  if (!isObject(incoming)) {
    return isObject(existing) ? { ...existing } : {};
  }
  const result: JsonObject = isObject(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key === HOOK_EVENTS_KEY && isObject(value)) {
      result[key] = mergeHooks(result[key], value);
      continue;
    }
    if (key === "permissions" && isObject(value)) {
      result[key] = mergePermissions(result[key], value);
      continue;
    }
    result[key] = mergeValue(result[key], value);
  }
  return result;
}
