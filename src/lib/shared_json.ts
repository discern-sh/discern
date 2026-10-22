/**
 * The one serializer for Shared JSON files: provider configuration that other
 * tools also write. discern adopts the existing file's layout, so a co-writer's
 * formatting survives discern's entry and neither tool churns the other's bytes.
 * A new file, or one that offers no layout evidence, gets two-space indentation
 * and a trailing newline.
 */

/** How one JSON document is laid out as text. */
export interface JsonTextStyle {
  /** One indentation level, or `""` for a single-line document. */
  readonly indent: string;
  readonly eol: "\n" | "\r\n";
  readonly finalNewline: boolean;
}

/** The layout of a JSON file discern creates. */
export const DEFAULT_JSON_TEXT_STYLE: JsonTextStyle = Object.freeze({
  indent: "  ",
  eol: "\n",
  finalNewline: true,
});

/**
 * Read the layout of existing JSON text. Indentation comes from the first
 * indented line; a single-line document with content stays single-line; an
 * empty container or absent file falls back to the default indentation. Line
 * endings and the final newline follow the text whenever it has any content.
 */
export function jsonTextStyle(text: string | undefined): JsonTextStyle {
  const trimmed = text?.trim() ?? "";
  if (text === undefined || trimmed === "") {
    return DEFAULT_JSON_TEXT_STYLE;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = text.endsWith("\n");
  const indented = /\n([ \t]+)\S/u.exec(text)?.[1];
  if (indented !== undefined) {
    return { indent: indented, eol, finalNewline };
  }
  const singleLine = !/[\r\n]/u.test(trimmed);
  const emptyContainer = /^(?:\{\s*\}|\[\s*\])$/u.test(trimmed);
  return {
    indent: singleLine && !emptyContainer ? "" : DEFAULT_JSON_TEXT_STYLE.indent,
    eol,
    finalNewline,
  };
}

/** Render a JSON value in an explicit layout. */
export function renderJsonText(value: unknown, style: JsonTextStyle): string {
  const body = JSON.stringify(value, null, style.indent);
  const lines = style.eol === "\n" ? body : body.replaceAll("\n", style.eol);
  return style.finalNewline ? `${lines}${style.eol}` : lines;
}

/**
 * Serialize a Shared JSON file's next value in the layout of its current text
 * (`undefined` when the file does not exist yet).
 */
export function serializeSharedJson(
  value: unknown,
  existingText: string | undefined,
): string {
  return renderJsonText(value, jsonTextStyle(existingText));
}
