/**
 * The shape of one third-party component bundled into the compiled binary.
 *
 * The component list itself is generated: `deno task codegen` derives it from
 * the compile graph of `src/main.ts` (see `scripts/third_party_codegen.ts`)
 * and writes `src/lib/third_party_components.json`. This module carries only
 * the type, so the binary's module graph stays free of the generator's I/O.
 */

/** One third-party package embedded in the compiled binary. */
export interface ThirdPartyComponent {
  readonly name: string;
  readonly version: string;
  /** The registry the package resolves from (`"npm"` or `"jsr"`). */
  readonly registry: string;
  /** The license label — an SPDX identifier when one is known. */
  readonly license: string;
}
