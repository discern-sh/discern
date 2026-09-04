/**
 * Render the internal hint inventory from the live registry. The committed page
 * is a generated audit surface; it has no hand-maintained entry list.
 */

import { type HintDef, HINTS } from "./hints.ts";
import { renderCommandRefsCli } from "./command_reference.ts";
import { markdownBlockquote } from "./markdown_blockquote.ts";
import { GENERATED_INVENTORY_POLICIES } from "../../scripts/generated_inventory_policy.ts";

/** Render one registry entry with its registered example parameters. */
function renderEntry(def: HintDef<unknown>): string {
  const when = def.when?.trim();
  if (when === undefined || when === "") {
    throw new Error(`hint ${def.id} has no emitting context`);
  }
  if (/\r|\n/.test(when)) {
    throw new Error(`hint ${def.id} has a multi-line emitting context`);
  }
  // The inventory is a CLI-canonical page: command references render in
  // their CLI spelling, exactly as `fire` delivers them to the envelope.
  const example = renderCommandRefsCli(def.template(def.example));
  const interactiveExample = def.interactiveTemplate === undefined
    ? undefined
    : renderCommandRefsCli(def.interactiveTemplate(def.example));
  return [
    `## \`${def.id}\``,
    "",
    `- Category: \`${def.category}\``,
    `- Audience: \`${def.audience}\``,
    `- Family: ${def.family === undefined ? "—" : `\`${def.family}\``}`,
    `- Emitting context: ${when}`,
    "",
    "Rendered example:",
    "",
    markdownBlockquote(example),
    ...(interactiveExample === undefined || interactiveExample === example
      ? []
      : [
        "",
        "Interactive example:",
        "",
        markdownBlockquote(interactiveExample),
      ]),
  ].join("\n");
}

/** Render the complete, id-sorted internal hint inventory. */
export function renderHintInventoryDoc(): string {
  const policy = GENERATED_INVENTORY_POLICIES.hints;
  const defs = Object.values(HINTS) as unknown as readonly HintDef<unknown>[];
  const entries = [...defs].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  return [
    policy.banner,
    "",
    `# ${policy.title}`,
    "",
    `_${policy.subtitle}_`,
    "",
    ...policy.framing.flatMap((paragraph) => [paragraph, ""]),
    entries.map(renderEntry).join("\n\n"),
    "",
  ].join("\n");
}
