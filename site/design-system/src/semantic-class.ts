const SEGMENT = /^[a-z][a-z0-9-]*$/;

function assertSegment(value: string, label: string): void {
  if (!SEGMENT.test(value)) {
    throw new Error(`${label} must match ${SEGMENT}; received ${value}`);
  }
}

/** Build a documented class for framework-neutral semantic HTML. */
export function semanticClass(
  component: string,
  options: { readonly element?: string; readonly modifier?: string } = {},
): `discern-${string}` {
  assertSegment(component, "component");
  if (options.element !== undefined) {
    assertSegment(options.element, "element");
  }
  if (options.modifier !== undefined) {
    assertSegment(options.modifier, "modifier");
  }
  const element = options.element === undefined ? "" : `__${options.element}`;
  const modifier = options.modifier === undefined
    ? ""
    : `--${options.modifier}`;
  return `discern-${component}${element}${modifier}`;
}
