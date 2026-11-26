/**
 * The homepage body: the pool, the lens, the wall of cards, and the closing
 * call to action. The server renders this component to markup and the browser
 * island hydrates the same component with the same props, so it must render
 * identically in both places: no clock, no randomness, and nothing read from
 * the browser before an effect runs.
 */
import {
  type MutableRefObject,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Card } from "./Card.tsx";
import { WALL_DECK, WALL_LENSES } from "./deck.ts";
import type { WallPageProps } from "./host.ts";
import { Lens, LENS_REST, lensGroups, lensStatus, useLens } from "./Lens.tsx";
import { OpenCard } from "./OpenCard.tsx";
import {
  CopyPrompt,
  CopyStatus,
  SetupPromptWords,
  useSetupPrompt,
} from "./SetupPrompt.tsx";
import {
  wallKnobDefaults,
  type WallKnobName,
  wallKnobStyle,
  type WallKnobValues,
} from "./tuning/knobs.ts";
import { Panel, tuningRequested } from "./tuning/Panel.tsx";
import type { WallCard } from "./types.ts";
import { useLight } from "./use_light.ts";
import { useOpenCard } from "./use_open_card.ts";
import { useStage } from "./use_stage.ts";
import { WorksWith } from "./WorksWith.tsx";

/** What discern asks of a project, in the badge above the headline. */
export const WALL_FACTS = "Any stack. Runs offline. No API key.";

/** Where both calls to action lead. */
export const MANUAL_START = "/docs/start";

/** The closing section's heading, which the link past the cards leads to. */
const CLOSING_TITLE_ID = "wall-closing-title";

/**
 * The link that starts a visitor on the manual. It is a section's first
 * action, or with `quiet` its second.
 */
function StartLink(
  { quiet = false }: { readonly quiet?: boolean },
): ReactElement {
  return (
    <a
      className={quiet ? "wall-cta wall-quiet" : "wall-cta"}
      href={MANUAL_START}
    >
      Get started <span aria-hidden="true">→</span>
    </a>
  );
}

/**
 * Moves focus from a card's server link to the button that takes its place. A
 * keyboard visitor may already be on that link when script arrives. The wall
 * renders this only once it is live, so it never renders on the server, and
 * its effect runs before the browser paints the buttons.
 */
function FocusHandover(
  { card }: { readonly card: MutableRefObject<HTMLElement | null> },
): null {
  useLayoutEffect(() => {
    card.current?.querySelector<HTMLButtonElement>("button.wall-card-open")
      ?.focus({ preventScroll: true });
    card.current = null;
  }, [card]);
  return null;
}

/**
 * The whole homepage body under one root, `.wall`. The root carries every
 * tuning knob as a `--wall-<name>` custom property and the page's state as
 * data attributes for the stylesheets:
 *
 * - `data-wall-live` once the island has hydrated. Controls that need script
 *   stay hidden until then, so a page without script shows no dead controls:
 *   the lens bar, and the two controls that copy the setup prompt.
 * - `data-wall-drift` while the drift knob is above zero, which is the only
 *   time anything on the wall moves by itself.
 * - `data-wall-paused` while the visitor has paused that drift.
 *
 * The stage adds its own mark to the same root: see `use_stage.ts`.
 *
 * The list holds the cards in the order the active lens gives them: the cards
 * it kept, then one divider, then the rest. A card keeps its element when the
 * order changes, so the list's order is the only thing a lens moves. With no
 * lens the list is the deck and holds no divider.
 *
 * Each of the pool and the closing section offers the same two actions, and
 * leads with a different one. The pool leads with the manual and keeps the
 * copy control quiet beside it. The closing section shows the setup prompt's
 * words and leads with the control that copies them. One status line, in the
 * closing section, speaks for both copy controls.
 */
export function WallPage(
  { headline, categoryLine, linkLabels, agents }: WallPageProps,
): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const focusedCard = useRef<HTMLElement | null>(null);
  const { lens, select: selectLens } = useLens(WALL_LENSES);
  const opened = useOpenCard(WALL_DECK);
  const prompt = useSetupPrompt();
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [knobs, setKnobs] = useState<WallKnobValues>(wallKnobDefaults);
  useLight(root);
  useStage(root);
  useEffect(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement && root.current?.contains(active) &&
      active.matches("a.wall-card-open")
    ) {
      focusedCard.current = active.closest<HTMLElement>(".wall-card");
    }
    setLive(true);
    setTuning(tuningRequested(globalThis.location.search));
  }, []);

  const setKnob = (name: WallKnobName, value: number): void =>
    setKnobs((was) => ({ ...was, [name]: value }));
  const drifting = knobs.drift > 0;
  const groups = lensGroups(lens, WALL_DECK);
  const cards = (
    group: readonly WallCard[],
    receded: boolean,
  ): ReactElement[] =>
    group.map((card) => (
      <Card
        key={`card:${card.id}`}
        card={card}
        receded={receded}
        live={live}
        onOpen={opened.open}
      />
    ));

  return (
    <div
      ref={root}
      className="wall"
      style={wallKnobStyle(knobs)}
      data-wall-live={live ? "" : undefined}
      data-wall-drift={drifting ? "" : undefined}
      data-wall-paused={drifting && paused ? "" : undefined}
    >
      <section className="wall-pool" aria-labelledby="wall-headline">
        <p className="wall-eyebrow">{WALL_FACTS}</p>
        <h1 id="wall-headline" className="wall-headline">{headline}</h1>
        <p className="wall-category">{categoryLine}</p>
        <div className="wall-actions">
          <StartLink />
          <CopyPrompt
            quiet
            copied={prompt.copiedBy === "pool"}
            onCopy={() => prompt.copy("pool")}
          />
        </div>
        <WorksWith agents={agents} />
      </section>

      <section className="wall-stage" aria-label="What discern does">
        <a className="wall-skip" href={`#${CLOSING_TITLE_ID}`}>
          Skip the cards
        </a>
        <div className="wall-controls">
          <Lens
            lenses={WALL_LENSES}
            active={lens?.id ?? null}
            status={lensStatus(lens, groups)}
            onSelect={selectLens}
          />
        </div>
        {drifting
          ? (
            <button
              type="button"
              className="wall-pause"
              aria-pressed={paused}
              onClick={() => setPaused((was) => !was)}
            >
              Pause motion
            </button>
          )
          : null}
        <div className="wall-plane">
          <ul className="wall-list" role="list">
            {[
              ...cards(groups.kept, false),
              ...(groups.rest.length === 0
                ? []
                : [<li key="rest" className="wall-rest">{LENS_REST}</li>]),
              ...cards(groups.rest, true),
            ]}
          </ul>
        </div>
      </section>

      <section className="wall-closing" aria-labelledby={CLOSING_TITLE_ID}>
        <h2
          id={CLOSING_TITLE_ID}
          className="wall-closing-title"
          tabIndex={-1}
        >
          Ready when you are.
        </h2>
        <p className="wall-closing-line">
          Ask your coding agent to set up discern in your project.
        </p>
        <SetupPromptWords />
        <div className="wall-actions">
          <CopyPrompt
            copied={prompt.copiedBy === "closing"}
            onCopy={() => prompt.copy("closing")}
          />
          <StartLink quiet />
        </div>
        <CopyStatus outcome={prompt.outcome} />
      </section>

      {live ? <FocusHandover card={focusedCard} /> : null}
      <OpenCard
        card={opened.card}
        linkLabels={linkLabels}
        onClose={opened.close}
      />
      {tuning
        ? (
          <Panel
            values={knobs}
            onChange={setKnob}
            onReset={() => setKnobs(wallKnobDefaults())}
          />
        )
        : null}
    </div>
  );
}
