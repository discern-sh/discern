/**
 * Third-party software notices for the components bundled into the `discern`
 * binary.
 *
 * SINGLE SOURCE OF TRUTH: {@link THIRD_PARTY_COMPONENTS} lists every third-party
 * package embedded in the compiled binary — the JSR packages in the module graph
 * of `src/main.ts` (the `@std/*` and `@cliffy/*` families and `@zod/zod`) plus
 * the npm `@modelcontextprotocol/sdk` and the transitive npm closure REACHABLE
 * from its `server/mcp.js` + `server/stdio.js` entry points (the HTTP/SSE
 * transport dependencies — express, hono, cors, jose, … — are not reachable from
 * that path and are therefore not embedded). {@link LICENSE_TEXTS} carries each
 * license family's verbatim body.
 *
 * {@link renderThirdPartyNotices} renders the notices document. `deno task
 * codegen` writes it to the repo-root `THIRD_PARTY_NOTICES`, and the `discern
 * licenses` verb prints the same text (it is compiled into the binary, so the
 * notices travel with every copy).
 *
 * Keep this in step with the dependency graph:
 * `tests/third_party_notices_test.ts` pins the committed file to the render, ties
 * the component set to what `src/` actually imports, and pins every version to
 * `deno.lock`. When a dependency is added, removed, or bumped, update this list
 * and run `deno task codegen`.
 */

/** The license identifiers used by the embedded components (SPDX). */
export type LicenseId = "MIT" | "ISC" | "BSD-3-Clause";

/** One third-party component embedded in the binary. */
export interface ThirdPartyComponent {
  readonly name: string;
  readonly version: string;
  readonly registry: "npm" | "jsr";
  readonly license: LicenseId;
  /** The component's own copyright line(s), reproduced verbatim. */
  readonly copyright: string;
}

const DENO_AUTHORS = "Copyright 2018-2022 the Deno authors";
const CLIFFY = "Copyright (c) 2020-2023 Benjamin Fischer <c4spar@gmx.de>";
const EVGENY_2017 = "Copyright (c) 2017 Evgeny Poberezkin";
const ZOD = "Copyright (c) 2025 Colin McDonnell";

export const THIRD_PARTY_COMPONENTS: readonly ThirdPartyComponent[] = [
  // JSR — the Deno standard library (@std/*), all MIT, © the Deno authors.
  {
    name: "@std/assert",
    version: "1.0.19",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/collections",
    version: "1.2.0",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/encoding",
    version: "1.0.10",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/fmt",
    version: "1.0.10",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/fs",
    version: "1.0.24",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/internal",
    version: "1.0.14",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/io",
    version: "0.225.3",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/path",
    version: "1.1.5",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/text",
    version: "1.0.19",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },
  {
    name: "@std/toml",
    version: "1.0.11",
    registry: "jsr",
    license: "MIT",
    copyright: DENO_AUTHORS,
  },

  // JSR — Cliffy (the CLI framework), all MIT, © Benjamin Fischer (c4spar).
  {
    name: "@cliffy/ansi",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },
  {
    name: "@cliffy/command",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },
  {
    name: "@cliffy/flags",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },
  {
    name: "@cliffy/internal",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },
  {
    name: "@cliffy/keycode",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },
  {
    name: "@cliffy/prompt",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },
  {
    name: "@cliffy/table",
    version: "1.2.1",
    registry: "jsr",
    license: "MIT",
    copyright: CLIFFY,
  },

  // JSR — Zod (schema validation), used directly by discern. Same code and
  // author as the npm `zod` the SDK depends on.
  {
    name: "@zod/zod",
    version: "4.4.3",
    registry: "jsr",
    license: "MIT",
    copyright: ZOD,
  },

  // npm — the Model Context Protocol SDK and the npm packages reachable from its
  // stdio + high-level-server entry points.
  {
    name: "@modelcontextprotocol/sdk",
    version: "1.29.0",
    registry: "npm",
    license: "MIT",
    copyright: "Copyright (c) 2024 Anthropic, PBC",
  },
  {
    name: "zod",
    version: "4.4.3",
    registry: "npm",
    license: "MIT",
    copyright: ZOD,
  },
  {
    name: "zod-to-json-schema",
    version: "3.25.2",
    registry: "npm",
    license: "ISC",
    copyright: "Copyright (c) 2020, Stefan Terdell",
  },
  {
    name: "ajv",
    version: "8.20.0",
    registry: "npm",
    license: "MIT",
    copyright: "Copyright (c) 2015-2021 Evgeny Poberezkin",
  },
  {
    name: "ajv-formats",
    version: "3.0.1",
    registry: "npm",
    license: "MIT",
    copyright: "Copyright (c) 2020 Evgeny Poberezkin",
  },
  {
    name: "fast-deep-equal",
    version: "3.1.3",
    registry: "npm",
    license: "MIT",
    copyright: EVGENY_2017,
  },
  {
    name: "json-schema-traverse",
    version: "1.0.0",
    registry: "npm",
    license: "MIT",
    copyright: EVGENY_2017,
  },
  {
    name: "require-from-string",
    version: "2.0.2",
    registry: "npm",
    license: "MIT",
    copyright: "Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com>",
  },
  {
    name: "fast-uri",
    version: "3.1.2",
    registry: "npm",
    license: "BSD-3-Clause",
    copyright:
      "Copyright (c) 2011-2021 Gary Court; Copyright (c) 2021-present The Fastify team",
  },
];

/** The order license families are rendered in, and their display names. */
const LICENSE_ORDER: readonly LicenseId[] = ["MIT", "ISC", "BSD-3-Clause"];
const LICENSE_NAMES: Record<LicenseId, string> = {
  "MIT": "MIT License",
  "ISC": "ISC License",
  "BSD-3-Clause": "BSD 3-Clause License",
};

/**
 * The verbatim body of each license — the permission and warranty text that must
 * accompany the per-component copyright notices listed above it. Reproduced from
 * the packages' own LICENSE files (identical across every component in a family).
 */
export const LICENSE_TEXTS: Record<LicenseId, string> = {
  "MIT":
    `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,

  "ISC":
    `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,

  "BSD-3-Clause": `All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
};

const RULE = "-".repeat(78);

/**
 * Render the third-party notices document: an intro, then one section per
 * license family (in {@link LICENSE_ORDER}) listing its components with their
 * copyright lines followed by the verbatim license body. Deterministic — the
 * same input always yields the same bytes, so it can be diff-guarded.
 */
export function renderThirdPartyNotices(): string {
  const nameWidth = Math.max(
    ...THIRD_PARTY_COMPONENTS.map((c) => c.name.length),
  );
  const versionWidth = Math.max(
    ...THIRD_PARTY_COMPONENTS.map((c) => c.version.length),
  );

  const lines: string[] = [
    "discern - Third-Party Software Notices",
    "=".repeat(78),
    "",
    "The discern binary bundles the third-party, open-source components listed",
    "below. Each component's copyright notice and license text is reproduced here,",
    "as those licenses require.",
    "",
    "This file is generated from the dependency graph of src/main.ts. Regenerate it",
    "with `deno task codegen`; `discern licenses` prints the same notices from any",
    "installed binary.",
    "",
  ];

  for (const id of LICENSE_ORDER) {
    const group = THIRD_PARTY_COMPONENTS
      .filter((c) => c.license === id)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    if (group.length === 0) continue;

    lines.push(RULE, LICENSE_NAMES[id], RULE, "");
    lines.push(
      group.length === 1
        ? `The following component is licensed under the ${LICENSE_NAMES[id]}:`
        : `The following components are licensed under the ${
          LICENSE_NAMES[id]
        }:`,
      "",
    );
    for (const c of group) {
      lines.push(
        `  ${c.name.padEnd(nameWidth)}  ${
          c.version.padEnd(versionWidth)
        }  ${c.copyright}`,
      );
    }
    lines.push("", LICENSE_TEXTS[id], "");
  }

  return lines.join("\n") + "\n";
}
