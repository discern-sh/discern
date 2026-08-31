/** Route-neutral chrome and conversion pieces shared by public campaigns. */

import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, SkipLink } from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";

/** The commissioning instruction shared by every public Copy prompt control. */
export const COPY_PROMPT_TEXT =
  "Read https://discern.sh/llms.txt and set up discern in this project. Follow the setup process, study the repository before changing it, and bring me every decision or consent point that requires my input.";

/** Keep the product name in its public monospace treatment. */
export function DiscernName() {
  return <span className="landing-brand-name">discern</span>;
}

/** Static theme control wired at runtime by the shared /assets/theme.js. */
export function CampaignThemeToggle(
  { className }: { readonly className?: string },
) {
  const classes = [
    "discern-theme-toggle",
    "discern-theme-toggle--outlined",
    className,
  ].filter((candidate) => candidate !== undefined).join(" ");
  return (
    <button
      type="button"
      className={classes}
      aria-label="Switch to the dark theme"
      aria-pressed="false"
      data-theme-toggle
    >
      <span className="discern-theme-toggle__glyph" aria-hidden="true">
        <span data-theme-toggle-glyph="light">☀</span>
        <span data-theme-toggle-glyph="dark">☾</span>
      </span>
    </button>
  );
}

interface CampaignLink {
  readonly label: string;
  readonly href: string;
}

interface CampaignFooterGroup {
  readonly title: string;
  readonly links: readonly CampaignLink[];
}

export interface CampaignHeaderProps {
  readonly className?: string;
  readonly navLabel: string;
  readonly navItems: readonly CampaignLink[];
  readonly actions?: ReactNode;
}

/** Standard public header with navigation and calls to action supplied by the page. */
export function CampaignHeader(
  { className, navLabel, navItems, actions }: CampaignHeaderProps,
) {
  return (
    <SiteHeader
      {...(className === undefined ? {} : { className })}
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      navLabel={navLabel}
      navItems={navItems}
      actions={actions}
      sticky
      variant="campaign"
    />
  );
}

export interface CampaignFooterProps {
  readonly className?: string;
  readonly description: string;
  readonly groups: readonly CampaignFooterGroup[];
  readonly legal?: ReactNode;
  readonly meta?: ReactNode;
}

/** Standard public footer with destinations and legal actions supplied by the page. */
export function CampaignFooter(
  { className, description, groups, legal, meta }: CampaignFooterProps,
) {
  const classes = ["landing-footer", className]
    .filter((candidate) => candidate !== undefined).join(" ");
  return (
    <SiteFooter
      className={classes}
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      description={description}
      groups={groups}
      legal={legal}
      meta={meta}
    />
  );
}

export interface CopyPromptProps {
  readonly id: string;
  readonly label: string;
  readonly buttonLabel?: string;
  readonly copiedLabel?: string;
  readonly linkLabel?: string;
  readonly linkHref?: string;
}

/** One visible commissioning instruction with an optional progressive copy action. */
export function CopyPrompt(
  {
    id,
    label,
    buttonLabel = "Copy prompt",
    copiedLabel = "Prompt copied",
    linkLabel = "Read the machine guide",
    linkHref = "/llms.txt",
  }: CopyPromptProps,
) {
  return (
    <div className="landing-copy-prompt">
      <p className="landing-copy-prompt__label">{label}</p>
      <p className="landing-copy-prompt__text" id={id}>{COPY_PROMPT_TEXT}</p>
      <div className="landing-copy-prompt__actions">
        <button
          type="button"
          className="discern-button discern-button--primary landing-copy-prompt__button"
          data-copy-prompt
          data-copy-prompt-target={id}
          data-copy-label={buttonLabel}
          data-copied-label={copiedLabel}
          hidden
        >
          <span className="discern-button__label">{buttonLabel}</span>
        </button>
        <a className="landing-copy-prompt__link" href={linkHref}>
          {linkLabel}
        </a>
      </div>
      <p
        className="landing-copy-prompt__status"
        id={`${id}-status`}
        role="status"
        aria-live="polite"
      >
      </p>
    </div>
  );
}

export interface CampaignShellProps {
  readonly header: ReactNode;
  readonly children?: ReactNode;
  readonly footer: ReactNode;
}

/** Stable chrome around a page-owned body with no prescribed section structure. */
export function CampaignShell(
  { header, children, footer }: CampaignShellProps,
) {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      {header}
      <main id="main">{children}</main>
      {footer}
    </>
  );
}
