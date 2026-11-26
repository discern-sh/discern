/**
 * The setup prompt: the instruction a visitor hands their coding agent, the
 * control that copies it, and the status line that says how a copy went.
 */
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SYSTEM_SCHEDULER,
  type TimeoutHandle,
} from "../../src/shared/scheduler.ts";

/**
 * The words a visitor pastes into a coding agent to set discern up. This is
 * their one source: the page shows them once, in the closing section, and
 * every copy control puts this same text on the clipboard.
 */
export const SETUP_PROMPT =
  "Read https://discern.sh/llms.txt to understand what discern does, explain the benefits, then begin the setup process to configure it in this project. If there's a decision only I can make or a setup step needs my consent, ask me.";

/** The id of the element that shows the prompt, which a refused copy selects. */
export const SETUP_PROMPT_ID = "wall-setup-prompt";

/** What a copy control says at rest, and for a moment after a copy. */
export const COPY_LABEL = "Copy setup prompt";
export const COPIED_LABEL = "Copied";

/** How a copy went: not asked for, taken by the clipboard, or refused by it. */
export type CopyOutcome = "idle" | "copied" | "refused";

/** What the status line says of each outcome. */
export const COPY_STATUS: Readonly<Record<CopyOutcome, string>> = {
  idle: "",
  copied: "Setup prompt copied. Paste it into your coding agent.",
  refused:
    "Your browser blocked the clipboard. Copy the selected prompt by hand.",
};

/** The page's copy controls, by the section each stands in. */
export type CopyControl = "pool" | "closing";

/** How long a control goes on saying that it copied. */
const COPIED_HOLD_MS = 2400;

/** How long the clipboard has to answer before the copy counts as refused. */
const CLIPBOARD_WAIT_MS = 1000;

/** The last copy, as the page shows it. */
interface Copy {
  /** How it went. A copy that worked reads "idle" again shortly. */
  readonly outcome: CopyOutcome;
  /** The control that copied a moment ago, or nothing. */
  readonly copiedBy: CopyControl | null;
}

const NO_COPY: Copy = { outcome: "idle", copiedBy: null };

/** What the wall page needs to show the prompt's controls and their state. */
export interface SetupPromptState extends Copy {
  /** Copy the prompt for one control. The promise settles once the page shows how it went. */
  readonly copy: (control: CopyControl) => Promise<void>;
}

/**
 * Put text on the clipboard. The promise rejects when the browser refuses: a
 * browser does so outside a secure page, without the visitor's leave, or by
 * having no clipboard at all. One that never answers counts as refusing.
 */
async function writeToClipboard(text: string): Promise<void> {
  let watchdog: TimeoutHandle | undefined;
  const unanswered = new Promise<never>((_, refuse) => {
    watchdog = SYSTEM_SCHEDULER.scheduleTimeout(
      () => refuse(new Error("the clipboard did not answer")),
      CLIPBOARD_WAIT_MS,
    );
  });
  try {
    await Promise.race([navigator.clipboard.writeText(text), unanswered]);
  } finally {
    if (watchdog !== undefined) SYSTEM_SCHEDULER.cancelTimeout(watchdog);
  }
}

/**
 * Hand the visitor the prompt to copy by hand: select its words where the
 * closing section shows them, bring them into view, and give them the focus,
 * so the next key the visitor presses can be the one that copies.
 */
function selectPrompt(): void {
  const words = document.getElementById(SETUP_PROMPT_ID);
  if (words === null) return;
  words.focus({ preventScroll: true });
  const box = words.getBoundingClientRect();
  if (box.top < 0 || box.bottom > globalThis.innerHeight) {
    words.scrollIntoView({ block: "center", behavior: "instant" });
  }
  const selection = globalThis.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(words);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Hold what the last copy came to, for every copy control on the page. A copy
 * that worked shows on the control that asked for it, for a moment. A copy
 * the browser refused selects the prompt instead and says so until the next
 * copy. Each request clears the last outcome first, so the status line speaks
 * again when the same outcome follows itself.
 */
export function useSetupPrompt(): SetupPromptState {
  const [last, setLast] = useState<Copy>(NO_COPY);
  const settling = useRef<TimeoutHandle | null>(null);
  const request = useRef(0);

  useEffect(() => () => {
    if (settling.current !== null) {
      SYSTEM_SCHEDULER.cancelTimeout(settling.current);
    }
  }, []);

  const copied = (control: CopyControl): void => {
    setLast({ outcome: "copied", copiedBy: control });
    settling.current = SYSTEM_SCHEDULER.scheduleTimeout(() => {
      settling.current = null;
      setLast(NO_COPY);
    }, COPIED_HOLD_MS);
  };
  const refused = (): void => {
    selectPrompt();
    setLast({ outcome: "refused", copiedBy: null });
  };
  const copy = (control: CopyControl): Promise<void> => {
    const mine = ++request.current;
    if (settling.current !== null) {
      SYSTEM_SCHEDULER.cancelTimeout(settling.current);
    }
    settling.current = null;
    setLast(NO_COPY);
    // A later request has the page by the time an earlier one settles, and
    // says how it went itself.
    return writeToClipboard(SETUP_PROMPT).then(
      () => {
        if (mine === request.current) copied(control);
      },
      () => {
        if (mine === request.current) refused();
      },
    );
  };

  return { ...last, copy };
}

/** A small line drawing beside a control's words, in the words' own ink. */
function Mark(
  { weight, children }: {
    readonly weight: string;
    readonly children: ReactNode;
  },
): ReactElement {
  return (
    <svg
      className="wall-copy-mark"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Two sheets of paper, one over the other: the mark of a copy. */
function CopyMark(): ReactElement {
  return (
    <Mark weight="1.5">
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5" />
      <path d="M10.25 5.75v-1.5a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
    </Mark>
  );
}

/** A tick: the mark of a copy that worked. */
function CopiedMark(): ReactElement {
  return (
    <Mark weight="1.75">
      <path d="M3.25 8.5l3 3 6.5-7" />
    </Mark>
  );
}

export interface CopyPromptProps {
  /** The quiet look of a section's second action. Without it, the first action's. */
  readonly quiet?: boolean;
  /** This control copied a moment ago, and says so in place of its label. */
  readonly copied: boolean;
  /** Called when the visitor asks for the prompt. */
  readonly onCopy: () => void;
}

/**
 * A control that copies the setup prompt. It needs script, so the stylesheet
 * keeps it out of sight until the wall is live.
 *
 * The control keeps the width of its label while it says that it copied: both
 * sets of words lie in one grid cell, and the label is only hidden, so the
 * row the control stands in does not move.
 */
export function CopyPrompt(
  { quiet = false, copied, onCopy }: CopyPromptProps,
): ReactElement {
  return (
    <button
      type="button"
      className={quiet ? "wall-copy wall-quiet" : "wall-copy"}
      data-copied={copied ? "" : undefined}
      onClick={onCopy}
    >
      <span className="wall-copy-words" aria-hidden={copied ? true : undefined}>
        <CopyMark />
        {COPY_LABEL}
      </span>
      {copied
        ? (
          <span className="wall-copy-words">
            <CopiedMark />
            {COPIED_LABEL}
          </span>
        )
        : null}
    </button>
  );
}

/**
 * The prompt's own words, for a visitor to read and to select by hand. They
 * are server markup, so they are there without script. The element takes the
 * focus only when a refused copy hands it over.
 */
export function SetupPromptWords(): ReactElement {
  return (
    <p id={SETUP_PROMPT_ID} className="wall-prompt" tabIndex={-1}>
      {SETUP_PROMPT}
    </p>
  );
}

/**
 * The polite status line for every copy control on the page. Assistive
 * technology reads each new outcome from it. It is drawn only for a refused
 * copy, which a control cannot show on its own face.
 */
export function CopyStatus(
  { outcome }: { readonly outcome: CopyOutcome },
): ReactElement {
  return (
    <p
      className="wall-copy-status"
      role="status"
      data-refused={outcome === "refused" ? "" : undefined}
    >
      {COPY_STATUS[outcome]}
    </p>
  );
}
