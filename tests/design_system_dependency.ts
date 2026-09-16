/** Immutable package contract shared by CLI and web consumer checks. */
export const DESIGN_SYSTEM_VERSION = "0.34.0";
export const DESIGN_SYSTEM_SPECIFIER =
  `jsr:@discern-sh/design-system@${DESIGN_SYSTEM_VERSION}`;
export const DESIGN_SYSTEM_PACKAGE =
  `@discern-sh/design-system@${DESIGN_SYSTEM_VERSION}`;
export const DESIGN_SYSTEM_ORIGIN =
  `https://jsr.io/@discern-sh/design-system/${DESIGN_SYSTEM_VERSION}/`;

/** Select React runtimes by Deno's resolved npm package identity, not checkout paths. */
export function reactRuntimeModules(specifiers: readonly string[]): string[] {
  return specifiers.filter((specifier) =>
    /^npm:\/?react(?:-dom)?(?:[/@]|$)/u.test(specifier)
  );
}
