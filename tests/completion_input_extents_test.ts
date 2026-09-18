/** Text extents are demanded work; content identity does not depend on sibling measurements. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import {
  FILES,
  obligations,
  PRODUCER_RECIPE,
  snapshot,
} from "./completion_producers_fixtures.ts";
import {
  resolveProducerGraph,
  type ValidationInputs,
} from "../src/engine/validation/catalog.ts";
import { validationInputSelection } from "../src/engine/validation/input_selection.ts";
import { observeValidationInputs } from "../src/engine/validation/runtime.ts";
import { observeCandidateInputs } from "../src/engine/validation/inputs.ts";

Deno.test("both input observers count only demanded text extents and never decode other bytes", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "src"));
    await Deno.mkdir(join(root, "docs"));
    await Deno.writeFile(
      join(root, "src", "payload"),
      Uint8Array.of(0, 255, 10, 32),
    );
    await Deno.writeTextFile(join(root, "tool.lock"), "tool\n");
    await Deno.writeTextFile(join(root, "docs", "sample"), "one two\nthree\n");
    await Deno.symlink("one two\n", join(root, "docs", "link"));
    await gitInit(root);
    const head = await gitOut(root, "rev-parse", "HEAD");
    for (
      const measure of [undefined, "files", "bytes", "lines", "words"] as const
    ) {
      const declarations = obligations().map((entry) =>
        entry.standard === undefined || measure === undefined ? entry : {
          ...entry,
          standard: {
            ...entry.standard,
            per: { kind: "extent" as const, measure, globs: ["docs/**"] },
          },
        }
      );
      const graph = resolveProducerGraph(
        { "jobs.test": PRODUCER_RECIPE },
        declarations,
      );
      const selection = validationInputSelection(
        graph.producers,
        declarations.map((entry, index) => {
          const producer = graph.selectors[index];
          assert(producer !== undefined);
          return { ...entry, producer };
        }),
      );
      const decode = TextDecoder.prototype.decode;
      let streamedDecodes = 0;
      TextDecoder.prototype.decode = function (
        this: TextDecoder,
        ...args: Parameters<TextDecoder["decode"]>
      ): string {
        if (args[1]?.stream === true) streamedDecodes++;
        return decode.apply(this, args);
      };
      let live: ValidationInputs;
      try {
        live = await observeValidationInputs(
          root,
          selection.toolchain,
          selection,
        );
        assertEquals(
          await observeCandidateInputs(
            root,
            head,
            selection.toolchain,
            selection,
          ),
          live,
        );
        assertEquals(streamedDecodes > 0, measure === "words");
      } finally {
        TextDecoder.prototype.decode = decode;
      }
      for (const path of ["src/payload", "tool.lock"]) {
        assert(live.files[path] !== undefined);
        assertEquals(live.files[path]?.lines, undefined);
        assertEquals(live.files[path]?.words, undefined);
      }
      if (measure !== undefined) {
        assertEquals(
          live.files["docs/sample"]?.lines,
          measure === "lines" ? 2 : undefined,
        );
        assertEquals(
          live.files["docs/sample"]?.words,
          measure === "words" ? 3 : undefined,
        );
        assertEquals(
          live.files["docs/link"]?.lines,
          measure === "lines" ? 1 : undefined,
        );
        assertEquals(
          live.files["docs/link"]?.words,
          measure === "words" ? 2 : undefined,
        );
        const planned = await snapshot({
          obligations: declarations,
          inputs: live,
        });
        assertEquals(
          planned.obligations.find((entry) => entry.standard !== null)?.extent,
          measure === "files"
            ? 2
            : measure === "bytes"
            ? 22
            : measure === "lines"
            ? 3
            : 5,
        );
      }
    }
  });
});

Deno.test("optional text observations do not change unrelated receipt identities", async () => {
  const full = await snapshot();
  const withoutText: ValidationInputs = {
    complete: true,
    files: Object.fromEntries(
      Object.entries(FILES.files).map((
        [path, file],
      ) => [path, { digest: file.digest, bytes: file.bytes }]),
    ),
  };
  const lean = await snapshot({ inputs: withoutText });
  assertEquals(
    lean.obligations.map((entry) => entry.applicability),
    full.obligations.map((entry) => entry.applicability),
  );
  const declared = obligations().map((entry) =>
    entry.standard === undefined ? entry : {
      ...entry,
      standard: {
        ...entry.standard,
        per: {
          kind: "extent" as const,
          measure: "lines" as const,
          globs: ["docs/**"],
        },
      },
    }
  );
  const linesOnly: ValidationInputs = {
    complete: true,
    files: {
      ...withoutText.files,
      "docs/a.md": { ...FILES.files["docs/a.md"], words: 999 },
    },
  };
  assertEquals(
    (await snapshot({ obligations: declared, inputs: linesOnly })).obligations,
    (await snapshot({ obligations: declared })).obligations,
  );
  await assertRejects(
    () => snapshot({ obligations: declared, inputs: withoutText }),
    Error,
    "lines",
  );
});
