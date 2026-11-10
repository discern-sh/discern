/**
 * Every tunable value on the homepage wall, in one table.
 *
 * The server writes each default as a `--wall-<name>` custom property on the
 * wall root, so the stylesheets read the variables with no fallback values and
 * the tuning panel edits the same properties in place.
 */
import type { CSSProperties } from "react";

export interface WallKnob {
  /** Kebab-case name; the custom property is `--wall-<name>`. */
  readonly name: string;
  /** The control's label in the tuning panel. */
  readonly label: string;
  /** CSS unit appended to the number, or "" for a bare number. */
  readonly unit: "" | "px" | "deg";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

export const WALL_KNOBS = [
  {
    name: "chroma",
    label: "Color",
    unit: "",
    min: 0,
    max: 0.22,
    step: 0.005,
    default: 0.15,
  },
  {
    name: "light-radius",
    label: "Light size",
    unit: "px",
    min: 200,
    max: 1000,
    step: 10,
    default: 520,
  },
  {
    name: "light-strength",
    label: "Light",
    unit: "",
    min: 0,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
  {
    name: "light-ease",
    label: "Light ease",
    unit: "",
    min: 0,
    max: 240,
    step: 10,
    default: 80,
  },
  {
    name: "light-fade",
    label: "Light fade",
    unit: "",
    min: 0,
    max: 600,
    step: 20,
    default: 240,
  },
  {
    name: "hover-tilt",
    label: "Hover tilt",
    unit: "deg",
    min: 0,
    max: 3,
    step: 0.25,
    default: 1.5,
  },
  {
    name: "drift",
    label: "Drift",
    unit: "px",
    min: 0,
    max: 8,
    step: 0.5,
    default: 0,
  },
  {
    name: "far-tilt",
    label: "Far tilt",
    unit: "deg",
    min: 0,
    max: 80,
    step: 1,
    default: 70,
  },
  {
    name: "far-scale",
    label: "Far scale",
    unit: "",
    min: 0.3,
    max: 1,
    step: 0.02,
    default: 0.44,
  },
  {
    name: "perspective",
    label: "Perspective",
    unit: "",
    min: 30,
    max: 200,
    step: 1,
    default: 64,
  },
  {
    name: "vanish",
    label: "Vanishing point",
    unit: "",
    min: -10,
    max: 40,
    step: 0.5,
    default: 9,
  },
  {
    name: "haze",
    label: "Haze",
    unit: "",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.9,
  },
  {
    name: "horizon",
    label: "Horizon glow",
    unit: "",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  {
    name: "glyph-weight",
    label: "Glyph weight",
    unit: "",
    min: 1,
    max: 2.6,
    step: 0.05,
    default: 1.75,
  },
  {
    name: "glyph-tint",
    label: "Glyph tint",
    unit: "",
    min: 0.08,
    max: 0.5,
    step: 0.01,
    default: 0.34,
  },
  {
    name: "gap",
    label: "Gap",
    unit: "px",
    min: 6,
    max: 30,
    step: 1,
    default: 14,
  },
  {
    name: "radius",
    label: "Radius",
    unit: "px",
    min: 4,
    max: 26,
    step: 1,
    default: 16,
  },
  {
    name: "grain",
    label: "Grain",
    unit: "",
    min: 0,
    max: 0.14,
    step: 0.005,
    default: 0.05,
  },
] as const satisfies readonly WallKnob[];

export type WallKnobName = (typeof WALL_KNOBS)[number]["name"];

/** One number per knob: the state the tuning panel edits. */
export type WallKnobValues = Readonly<Record<WallKnobName, number>>;

/** The inline style object that carries knob values to the stylesheets. */
export type WallKnobStyle = CSSProperties & Record<`--wall-${string}`, string>;

/** The custom property one knob is written to. */
export function wallKnobProperty<Name extends WallKnobName>(
  name: Name,
): `--wall-${Name}` {
  return `--wall-${name}`;
}

/** The shipped value of every knob. */
export function wallKnobDefaults(): WallKnobValues {
  return Object.fromEntries(
    WALL_KNOBS.map((knob) => [knob.name, knob.default]),
  ) as Record<WallKnobName, number>;
}

/**
 * Turn knob values into the wall root's inline style: one `--wall-<name>`
 * custom property per knob, each number followed by its unit. With no argument
 * it returns the defaults, which is what the server renders.
 */
export function wallKnobStyle(
  values: WallKnobValues = wallKnobDefaults(),
): WallKnobStyle {
  const style: Record<`--wall-${string}`, string> = {};
  for (const knob of WALL_KNOBS) {
    style[wallKnobProperty(knob.name)] = `${values[knob.name]}${knob.unit}`;
  }
  return style;
}
