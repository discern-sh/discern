/**
 * The document shell's drawn icons. Each is a stroked line graphic, so it
 * declares `fill="none"` and takes its colour from the text around it; an SVG
 * with neither attribute paints solid black and disappears on a dark canvas.
 * Package glyph slots size a direct `svg` child, so these render the element
 * itself rather than wrapping it.
 */
import type { ReactElement, SVGAttributes } from "react";

type IconProps = Omit<SVGAttributes<SVGSVGElement>, "children" | "viewBox">;

const LINE: SVGAttributes<SVGSVGElement> = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  "aria-hidden": true,
};

/** Three bars: opens the narrow-viewport navigation drawer. */
export function MenuIcon(props: IconProps): ReactElement {
  return (
    <svg {...LINE} strokeWidth={1.6} {...props}>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
}

/** A magnifier: opens the search palette. */
export function SearchIcon(props: IconProps): ReactElement {
  return (
    <svg {...LINE} strokeWidth={1.6} {...props}>
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.4 10.4 14 14" />
    </svg>
  );
}

/** The light-theme destination. Carries its own size: it renders outside an Icon allocation. */
export function SunIcon(props: IconProps): ReactElement {
  return (
    <svg {...LINE} width="1em" height="1em" strokeWidth={1.5} {...props}>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" />
    </svg>
  );
}

/** The dark-theme destination. Carries its own size: it renders outside an Icon allocation. */
export function MoonIcon(props: IconProps): ReactElement {
  return (
    <svg
      {...LINE}
      width="1em"
      height="1em"
      strokeWidth={1.5}
      strokeLinejoin="round"
      {...props}
    >
      <path d="M13.2 9.8A5.6 5.6 0 1 1 6.2 2.8a4.4 4.4 0 0 0 7 7z" />
    </svg>
  );
}
