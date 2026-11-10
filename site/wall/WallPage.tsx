/**
 * The homepage body: the pool, the lens, the wall of cards, and the closing
 * call to action. The server renders this component to markup and the browser
 * island hydrates the same component with the same props, so it must render
 * identically in both places: no clock, no randomness, and nothing read from
 * the browser before an effect runs.
 */
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Card } from "./Card.tsx";
import { WALL_DECK, WALL_LENSES } from "./deck.ts";
import type { WallPageProps } from "./host.ts";
import { Lens, LENS_REST, lensGroups, lensStatus, useLens } from "./Lens.tsx";
import { OpenCard } from "./OpenCard.tsx";
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

/** Where both calls to action lead. */
export const MANUAL_START = "/docs/start";

/** The closing section's heading, which the link past the cards leads to. */
const CLOSING_TITLE_ID = "wall-closing-title";

/** The link that starts a visitor on the manual. */
function StartLink(): ReactElement {
  return (
    <p className="wall-actions">
      <a className="wall-cta" href={MANUAL_START}>
        Get started <span aria-hidden="true">→</span>
      </a>
    </p>
  );
}

/**
 * The whole homepage body under one root, `.wall`. The root carries every
 * tuning knob as a `--wall-<name>` custom property and the page's state as
 * data attributes for the stylesheets:
 *
 * - `data-wall-live` once the island has hydrated. Controls that need script
 *   stay hidden until then, so a page without script shows no dead controls.
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
 */
export function WallPage(
  { mark, version, headline, categoryLine, linkLabels }: WallPageProps,
): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const { lens, select: selectLens } = useLens(WALL_LENSES);
  const opened = useOpenCard(WALL_DECK);
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [knobs, setKnobs] = useState<WallKnobValues>(wallKnobDefaults);
  useLight(root);
  useStage(root);
  useEffect(() => {
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
        <p className="wall-eyebrow">
          <span aria-hidden="true">{mark}</span>{" "}
          <span className="wall-name">discern</span>
          {` v${version}`}
        </p>
        <h1 id="wall-headline" className="wall-headline">{headline}</h1>
        <p className="wall-category">{categoryLine}</p>
        <StartLink />
        <p className="wall-facts">Any stack. Runs offline. No API key.</p>
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
        <StartLink />
      </section>

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
