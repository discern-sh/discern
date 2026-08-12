/** Reusable delta artwork. */

import type { CSSProperties, ReactElement } from "react";

export interface DeltaArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One short perpendicular hairline tick crossing a channel near its end. */
export interface DeltaGateTick {
  readonly x: number;
  readonly y1: number;
  readonly y2: number;
}

/** One channel of the delta: its curve, its gate, and its resting traveller. */
export interface DeltaChannel {
  readonly id: "top" | "middle" | "bottom";
  readonly d: string;
  readonly gate: DeltaGateTick;
  /** Authored resting offset-distance for this channel's chevron. */
  readonly chevronRest: string;
}

/**
 * The three channels between the fork and the confluence. Every channel
 * departs the fork horizontally and arrives at the merge horizontally, so
 * the single entry and exit lines continue each curve without a corner.
 */
export const DELTA_CHANNELS: readonly DeltaChannel[] = Object.freeze([
  {
    id: "top",
    d: "M 170 270 C 230 270 250 180 310 180 L 450 180 C 510 180 530 270 590 270",
    gate: { x: 438, y1: 167, y2: 193 },
    chevronRest: "40%",
  },
  {
    id: "middle",
    d: "M 170 270 L 590 270",
    gate: { x: 438, y1: 257, y2: 283 },
    chevronRest: "44%",
  },
  {
    id: "bottom",
    d: "M 170 270 C 230 270 250 360 310 360 L 450 360 C 510 360 530 270 590 270",
    gate: { x: 438, y1: 347, y2: 373 },
    chevronRest: "52%",
  },
]);

export const DELTA_CHANNEL_COUNT: number = DELTA_CHANNELS.length;

/** The gate ticks, one per channel, derived from the channel authority. */
export const DELTA_GATE_TICKS: readonly DeltaGateTick[] = Object.freeze(
  DELTA_CHANNELS.map(({ gate }) => gate),
);

export const DELTA_GATE_TICK_COUNT: number = DELTA_GATE_TICKS.length;

/** The guide the accent pulse travels: from the merge node off the plate. */
export const DELTA_EXIT_GUIDE = "M 590 270 L 790 270";

/** The open chevron mark travelling each channel, pointing along it. */
const CHEVRON_MARK = "M -6 -4.5 L 0 0 L -6 4.5";

/** Bind one chevron to its channel's curve at its authored rest position. */
function chevronStyle(channel: DeltaChannel): CSSProperties {
  return {
    offsetPath: `path('${channel.d}')`,
    offsetDistance: channel.chevronRest,
  };
}

/**
 * Fig. III — the delta. One hairline meets an open fork and divides into
 * three bowed channels whose travelling chevrons pass perpendicular gate
 * ticks before a filled confluence gathers them back into a single heavier
 * line. The authored SVG is the complete resolved plate — flow captured
 * mid-motion; the stylesheet supplies only the journey through it.
 */
export function DeltaArtwork(
  { id }: DeltaArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="fig fig-delta">
      <svg
        className="fig__art fig-delta__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          Three channels between a fork and a confluence
        </title>
        <desc id={descriptionId}>
          A hairline enters from the left and meets a small open triangle, where
          it divides into three parallel bowed channels. Small chevron marks
          travel the channels, crossing short perpendicular ticks, and gather at
          a filled triangle from which one heavier line continues to the right
          edge. Faint scaffolding and a shallow triangular envelope rest behind
          the flow.
        </desc>
        <g aria-hidden="true">
          <g className="fig-delta__construction">
            <path
              d="M 170 270 L 230 270 L 250 180 L 310 180"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 450 180 L 510 180 L 530 270 L 590 270"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 170 270 L 230 270 L 250 360 L 310 360"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 450 360 L 510 360 L 530 270 L 590 270"
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <path
            className="fig-delta__envelope"
            d="M 170 270 L 380 180 L 590 270 Z"
            vectorEffect="non-scaling-stroke"
          />

          {DELTA_CHANNELS.map((channel) => (
            <path
              key={channel.id}
              className="fig-delta__channel"
              data-delta-channel={channel.id}
              d={channel.d}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <line
            className="fig-delta__entry"
            x1={0}
            y1={270}
            x2={162}
            y2={270}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className="fig-delta__exit"
            x1={597}
            y1={270}
            x2={760}
            y2={270}
            vectorEffect="non-scaling-stroke"
          />

          {DELTA_CHANNELS.map((channel) => (
            <line
              key={channel.id}
              className={`fig-delta__gate fig-delta__gate--${channel.id}`}
              data-delta-gate={channel.id}
              x1={channel.gate.x}
              y1={channel.gate.y1}
              x2={channel.gate.x}
              y2={channel.gate.y2}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path
            className="fig-delta__fork"
            d="M 162 261 L 162 279 L 178 270 Z"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="fig-delta__merge"
            d="M 582 261 L 582 279 L 598 270 Z"
          />

          {DELTA_CHANNELS.map((channel) => (
            <path
              key={channel.id}
              className={`fig-delta__chevron fig-delta__chevron--${channel.id}`}
              data-delta-chevron={channel.id}
              d={CHEVRON_MARK}
              style={chevronStyle(channel)}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path
            className="fig-delta__pulse"
            d="M -7 0 L 0 0"
            style={{
              offsetPath: `path('${DELTA_EXIT_GUIDE}')`,
              offsetDistance: "0%",
            }}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </figure>
  );
}
