/** Package markup with the site's framework-neutral theme enhancement. */
import type { ReactElement } from "react";
import { ThemeToggle as PackageThemeToggle } from "discern-design-system/react";

/** The external theme client owns events and preference; this adapter emits its initial control. */
export function ThemeToggle(
  { className }: { readonly className?: string },
): ReactElement {
  return (
    <PackageThemeToggle
      theme="light"
      onThemeChange={() => undefined}
      {...(className === undefined ? {} : { className })}
      data-theme-toggle=""
      aria-pressed={false}
      darkGlyph={
        <>
          <span data-theme-toggle-glyph="light">☀</span>
          <span data-theme-toggle-glyph="dark">☾</span>
        </>
      }
    />
  );
}
