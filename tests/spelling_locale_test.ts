/** American-English and WSL 2 terminology guards for shipped product copy. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  bannedPhraseLines,
  stringLiterals,
  visibleMarkdown,
} from "./vocab_scan.ts";

export const AMERICAN_SPELLING_PAIRS = [
  { american: "color", british: String.raw`\bcolour(?:s|ed|ing|ful|less)?\b` },
  { american: "honor", british: String.raw`\bhonour(?:s|ed|ing|able)?\b` },
  { american: "behavior", british: String.raw`\bbehaviours?\b` },
  {
    american: "capitalize",
    british: String.raw`\bcapitalis(?:e|es|ed|ing|ation)\b`,
  },
  {
    american: "recognize",
    british: String.raw`\brecognis(?:e|es|ed|ing|able)\b`,
  },
  {
    american: "normalize",
    british: String.raw`\bnormalis(?:e|es|ed|ing|ation)\b`,
  },
  {
    american: "summarize",
    british: String.raw`\bsummaris(?:e|es|ed|ing|ation)\b`,
  },
  { american: "analyze", british: String.raw`\banalys(?:e|es|ed|ing)\b` },
  { american: "license", british: String.raw`\blicence(?:s|d|ing)?\b` },
] as const;

/** Production TypeScript files whose string literals enter the shipped binary. */
async function sourceFiles(): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/spelling_locale_test.ts#shipped-source-strings",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only src string literals enter the compiled product; code identifiers and repository tooling stay outside this prose rule.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
}

/** Authored text surfaces carrying current shipped product prose. */
async function textFiles(): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/spelling_locale_test.ts#shipped-text-surfaces",
    universe: "authored-text",
    narrow: {
      reason:
        "Installed templates, public schemas, the bundled manual, and the public getting-started map are shipped product prose; historical ADRs are dated evidence.",
      include: (rel) =>
        rel.startsWith("templates/") || rel.startsWith("schema/") ||
        rel.startsWith("project/manual/") ||
        rel === "project/map/10-getting-started/quickstart.md",
    },
  });
}

/** Current product-support prose, excluding dated and internal repository records. */
async function wslTextFiles(): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/spelling_locale_test.ts#wsl-support-copy",
    universe: "authored-text",
    narrow: {
      reason:
        "Windows support wording ships in templates, schemas, the manual, and the public map; historical ADRs and internal provider implementation tables are not support copy.",
      include: (rel) =>
        rel.startsWith("templates/") || rel.startsWith("schema/") ||
        rel.startsWith("project/manual/") ||
        (rel.startsWith("project/map/") &&
          !rel.startsWith("project/map/_")),
    },
  });
}

Deno.test("shipped copy uses American English", async () => {
  const offenders: string[] = [];
  const inspect = (rel: string, text: string, origin = ""): void => {
    for (const pair of AMERICAN_SPELLING_PAIRS) {
      const findings = bannedPhraseLines(
        rel,
        text,
        new RegExp(pair.british, "gi"),
      );
      offenders.push(
        ...findings.map((finding) =>
          `${finding}${origin} — use ${pair.american}`
        ),
      );
    }
  };
  for (const rel of await sourceFiles()) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const literal of stringLiterals(source)) {
      inspect(rel, literal.text, ` (literal starts at ${literal.line})`);
    }
  }
  for (const rel of await textFiles()) {
    inspect(
      rel,
      visibleMarkdown(await Deno.readTextFile(join(REPO_ROOT, rel))),
    );
  }
  assertEquals(
    offenders,
    [],
    `American English is the product locale:\n  ${offenders.join("\n  ")}`,
  );
});

const NONCANONICAL_WSL = [
  /\bWSL2\b/gi,
  /\bWindows Subsystem for Linux(?:\s+2)?\b/gi,
];
const NATIVE_WINDOWS_CLAIM =
  /\b(?:discern\s+)?(?:runs?|works?|is supported)\s+(?:natively\s+)?on Windows\b/gi;

Deno.test("WSL 2 is the only shipped Windows support name", async () => {
  const offenders: string[] = [];
  const inspect = (rel: string, text: string, origin = ""): void => {
    for (const pattern of [...NONCANONICAL_WSL, NATIVE_WINDOWS_CLAIM]) {
      offenders.push(
        ...bannedPhraseLines(rel, text, pattern).map((finding) =>
          `${finding}${origin}`
        ),
      );
    }
  };
  for (const rel of await sourceFiles()) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const literal of stringLiterals(source)) {
      inspect(rel, literal.text, ` (literal starts at ${literal.line})`);
    }
  }
  for (const rel of await wslTextFiles()) {
    inspect(
      rel,
      visibleMarkdown(await Deno.readTextFile(join(REPO_ROOT, rel))),
    );
  }
  assertEquals(
    offenders,
    [],
    "Use WSL 2 only and never imply a native Windows release; code identifiers " +
      `and historical ADR prose are deliberately outside this copy scope:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("locale detectors bite on each retired spelling and Windows claim", () => {
  for (const pair of AMERICAN_SPELLING_PAIRS) {
    assertEquals(
      new RegExp(pair.british, "i").test(
        pair.british.includes("colour")
          ? "colour"
          : pair.british.includes("honour")
          ? "honour"
          : pair.british.includes("behaviour")
          ? "behaviour"
          : pair.british.includes("capitalis")
          ? "capitalise"
          : pair.british.includes("recognis")
          ? "recognise"
          : pair.british.includes("normalis")
          ? "normalise"
          : pair.british.includes("summaris")
          ? "summarise"
          : pair.british.includes("analys")
          ? "analyse"
          : "licence",
      ),
      true,
    );
  }
  assertEquals(NONCANONICAL_WSL[0]?.test("WSL2"), true);
  assertEquals(
    NONCANONICAL_WSL[1]?.test("Windows Subsystem for Linux 2"),
    true,
  );
  assertEquals(NATIVE_WINDOWS_CLAIM.test("discern runs on Windows"), true);
});
