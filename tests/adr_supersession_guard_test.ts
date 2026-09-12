/**
 * Supersession hygiene across the decision archive (ADR 0310). Agents read the
 * archive as instruction material, so its structure must keep the current/
 * retired boundary honest without anyone remembering to: a record whose own
 * status declares it superseded belongs under `_superseded/`, every record
 * carries the one `**Status**:` form a scan can find, a current record that
 * claims to supersede a sibling names one that answers back (the target either
 * moved to `_superseded/` or references the claimer), every archived
 * record opens with the banner that explains its retirement, and a current
 * record's amendment notes read timelessly (ADR 0310): no note claims a cited
 * direction still awaits implementation, and no bold "Accepted …" label cites
 * a record that has since moved to `_superseded/`. Each rule failed
 * somewhere in the corpus before this guard existed — a status flipped to
 * "superseded" on a record that never moved, a `**Status:**` misspelling that
 * hid from pattern scans, supersessions recorded on only one of their two
 * records, and eight "accepted direction … implementation pending" notes
 * whose referents had long been implemented, amended, or superseded.
 */

import { basename, dirname, join } from "@std/path";
import { assertEquals } from "@std/assert";
import { ADR_SUBDIR, adrNumberOf } from "../src/lib/adr_numbers.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const ADR_DIR = join(REPO_AUTHORED_PATHS.map, ADR_SUBDIR);
const SUPERSEDED_DIR = join(ADR_DIR, "_superseded");
const ADR_REL = join(REPO_AUTHORED_PATHS.mapRel, ADR_SUBDIR);
const SUPERSEDED_REL = join(ADR_REL, "_superseded");

/** Every active or archived decision record governed by supersession hygiene. */
const ADR_RECORD_FILES = await structuralGuardScope({
  guard: "tests/adr_supersession_guard_test.ts#supersession-hygiene",
  universe: "tracked-markdown",
  narrow: {
    reason:
      "Supersession hygiene governs numbered records in the active and archived ADR directories.",
    include: (rel) =>
      dirname(rel) === ADR_REL || dirname(rel) === SUPERSEDED_REL,
  },
});

/** The copy-paste template's number — its placeholder status line legitimately
 * contains "superseded by ADR-NNNN", so every rule skips it. */
const TEMPLATE_NUMBER = "0000";

/** One record file: its number, repo-relative path, and full text. */
interface AdrRecord {
  number: string;
  path: string;
  text: string;
}

/** Numbered records directly inside a directory (no recursion), template excluded. */
async function recordsIn(archived: boolean): Promise<AdrRecord[]> {
  const records: AdrRecord[] = [];
  const directory = archived ? SUPERSEDED_REL : ADR_REL;
  for (
    const rel of ADR_RECORD_FILES.filter((path) => dirname(path) === directory)
  ) {
    const number = adrNumberOf(basename(rel));
    if (number === undefined || number === TEMPLATE_NUMBER) {
      continue;
    }
    records.push({
      number,
      path: rel,
      text: await Deno.readTextFile(join(REPO_ROOT, rel)),
    });
  }
  return records.sort((a, b) => a.number.localeCompare(b.number));
}

/** The value after `**Status**: `, or undefined when the line is absent. */
function statusValue(text: string): string | undefined {
  for (const line of text.split("\n")) {
    if (line.startsWith("**Status**: ")) {
      return line.slice("**Status**: ".length);
    }
  }
  return undefined;
}

/** Sentences of the text, with Markdown link targets masked first so the dots
 * inside `(...)` paths cannot split a sentence mid-link. Semicolons split too:
 * status lines chain relationship clauses with them ("supersedes X; builds on
 * Y"), and each clause claims only its own targets. */
function sentences(text: string): string[] {
  const masked = text.replace(/\]\([^)]*\)/g, "]()");
  return masked.split(/(?<=[.!?;])\s+/);
}

/** ADR numbers a sentence cites, linked (`[ADR 0212](…)`) or bare (`ADR 0212`).
 * The hyphenated `ADR-NNNN` placeholder form is not a citation. */
function citedNumbers(sentence: string): string[] {
  return [...sentence.matchAll(/\bADR (\d{4})\b/g)].map((m) => m[1] ?? "");
}

Deno.test("every record carries the one findable status form", async () => {
  const failures: string[] = [];
  const records = [
    ...(await recordsIn(false)),
    ...(await recordsIn(true)),
  ];
  for (const record of records) {
    if (statusValue(record.text) === undefined) {
      failures.push(`${record.path}: no \`**Status**: \` line`);
    }
    if (record.text.includes("**Status:**")) {
      failures.push(
        `${record.path}: malformed \`**Status:**\` — the colon sits outside the bold (\`**Status**: \`), where pattern scans can find it`,
      );
    }
  }
  assertEquals(failures, []);
});

Deno.test("a record whose status declares it superseded lives under _superseded/", async () => {
  const failures: string[] = [];
  for (const record of await recordsIn(false)) {
    const status = statusValue(record.text);
    if (status !== undefined && /^superseded by/i.test(status)) {
      failures.push(
        `${record.path}: status declares "superseded by" — move the record to ${SUPERSEDED_DIR}/ with a banner naming its successor (\`discern refresh\` rebuilds the index)`,
      );
    }
  }
  assertEquals(failures, []);
});

Deno.test("a status-line supersession claim is recorded on both records", async () => {
  const failures: string[] = [];
  const current = await recordsIn(false);
  const archivedNumbers = new Set(
    (await recordsIn(true)).map((r) => r.number),
  );
  const byNumber = new Map(current.map((r) => [r.number, r]));
  for (const record of current) {
    // Only the status line, and only the active voice: there a record speaks
    // as the superseder ("Supersedes [ADR NNNN]'s …"). Amendment banners carry
    // the mirror image — "ADR NNNN supersedes this record's …" — which is the
    // healthy self-annotation this rule exists to demand, not a claim.
    const status = statusValue(record.text);
    if (status === undefined) {
      continue;
    }
    for (const sentence of sentences(status)) {
      if (!/\bsupersedes\b/i.test(sentence)) {
        continue;
      }
      for (const target of citedNumbers(sentence)) {
        if (target === record.number || archivedNumbers.has(target)) {
          continue;
        }
        const targetRecord = byNumber.get(target);
        if (targetRecord === undefined) {
          failures.push(
            `${record.path}: a supersession sentence cites ADR ${target}, which is neither a current nor an archived record`,
          );
          continue;
        }
        if (!targetRecord.text.includes(`ADR ${record.number}`)) {
          failures.push(
            `${record.path}: claims a supersession against ADR ${target}, but ${targetRecord.path} never references ADR ${record.number} — record the amendment there in the same change (see the README's contributor rules)`,
          );
        }
      }
    }
  }
  assertEquals(failures, []);
});

Deno.test("every archived record opens with its retirement banner", async () => {
  const failures: string[] = [];
  for (const record of await recordsIn(true)) {
    const beforeFirstHeading = record.text.split("\n## ")[0] ?? "";
    if (!/^> \*\*/m.test(beforeFirstHeading)) {
      failures.push(
        `${record.path}: no leading \`> **…**\` banner — an archived record opens by naming its successor, or stating that it retired without one`,
      );
    }
  }
  assertEquals(failures, []);
});

Deno.test("a current record never claims a direction awaits implementation", async () => {
  const failures: string[] = [];
  for (const record of await recordsIn(false)) {
    if (/implementation pending/i.test(record.text)) {
      failures.push(
        `${record.path}: claims "implementation pending" — implementation state lives on the referent's own \`**Status**: \` line, which updates when it lands; an amendment note reads timelessly (ADR 0310): say what the cited record decided and what later settled it`,
      );
    }
  }
  assertEquals(failures, []);
});

Deno.test("an amendment label never asserts acceptance of an archived direction", async () => {
  const failures: string[] = [];
  const archivedNumbers = new Set(
    (await recordsIn(true)).map((r) => r.number),
  );
  for (const record of await recordsIn(false)) {
    for (const line of record.text.split("\n")) {
      if (!/\*\*Accepted\b/.test(line)) {
        continue;
      }
      const archivedCited = citedNumbers(line).filter((n) =>
        archivedNumbers.has(n)
      );
      if (archivedCited.length > 0) {
        failures.push(
          `${record.path}: a bold "Accepted …" label cites ADR ${
            archivedCited.join(", ADR ")
          }, which now lives under _superseded/ — reword the label and name what superseded the cited direction`,
        );
      }
    }
  }
  assertEquals(failures, []);
});
