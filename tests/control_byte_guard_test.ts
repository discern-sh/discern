/**
 * Repo-wide guard: no authored text file carries a raw control byte.
 *
 * The class of defect: a control character (NUL, ESC, ...) pasted into a
 * source file as the literal byte instead of written as an escape sequence.
 * The program is unchanged — a string built from the escape evaluates to
 * the same value — but the byte changes what the FILE is: POSIX text tools
 * classify it as binary, and BSD grep then reports nothing for it without
 * a word of warning, so searches and structural sweeps silently skip the
 * file. Two engine modules carried literal NUL separators exactly this way
 * before this guard existed — and the guard's own first draft caught its
 * author pasting the bytes it bans.
 *
 * The scan set is the declared authored-text universe — every tracked file that is
 * text by contract — so a new tree or format enrols automatically. Tab,
 * newline, and carriage return are ordinary text bytes and stay legal.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DELETE = 0x7f;
const SPACE = 0x20;

/** Whether `byte` makes a text file read as binary to POSIX text tools. */
function binaryMaking(byte: number): boolean {
  if (byte === TAB || byte === LINE_FEED || byte === CARRIAGE_RETURN) {
    return false;
  }
  return byte < SPACE || byte === DELETE;
}

/** Every offending byte in `bytes` as `line:byte` findings, empty when the
 * content is clean text. */
function controlByteFindings(bytes: Uint8Array): string[] {
  const findings: string[] = [];
  let line = 1;
  for (const byte of bytes) {
    if (byte === LINE_FEED) {
      line += 1;
    } else if (binaryMaking(byte)) {
      findings.push(`line ${line}: 0x${byte.toString(16).padStart(2, "0")}`);
    }
  }
  return findings;
}

Deno.test("the scanner flags a raw control byte and passes ordinary text", () => {
  const clean = new TextEncoder().encode("plain\ttext\r\nsecond line\n");
  assertEquals(controlByteFindings(clean), []);
  // Assembled byte-by-byte: writing the raw bytes into THIS file would, of
  // course, fail the guard below.
  const infected = Uint8Array.from([
    ...new TextEncoder().encode("key"),
    0x00,
    ...new TextEncoder().encode("value\n"),
    0x1b,
    ...new TextEncoder().encode("[31mred"),
  ]);
  assertEquals(controlByteFindings(infected), [
    "line 1: 0x00",
    "line 2: 0x1b",
  ]);
});

Deno.test("no authored text file carries a raw control byte", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/control_byte_guard_test.ts#raw-control-bytes",
      universe: "authored-text",
    })
  ) {
    const findings = controlByteFindings(
      await Deno.readFile(join(REPO_ROOT, rel)),
    );
    for (const finding of findings) {
      offenders.push(`${rel} ${finding}`);
    }
  }
  assertEquals(
    offenders,
    [],
    "these files carry raw control bytes, which make POSIX text tools " +
      "read them as binary (grep silently reports nothing for them). " +
      "Write the character as an escape sequence instead — the string " +
      'value is identical (e.g. "\\u0000") — or, for a genuine new binary ' +
      "format, name its extension in BINARY_EXTENSIONS " +
      "(tests/repo_authored_paths.ts).",
  );
});
