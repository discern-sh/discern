import { Button } from "discern-design-system/react";
/** Prompt source and accessible copy markup. */
export const COPY_PROMPT_TEXT =
  "Read https://discern.sh/llms.txt and set up discern in this project. Follow the setup process, study the repository before changing it, and bring me every decision or consent point that requires my input.";

/** Page-owned prompt and its progressive copy enhancement. */
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
        <Button
          type="button"
          className="landing-copy-prompt__button"
          data-copy-prompt
          data-copy-prompt-target={id}
          data-copy-label={buttonLabel}
          data-copied-label={copiedLabel}
          hidden
        >
          {buttonLabel}
        </Button>
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
