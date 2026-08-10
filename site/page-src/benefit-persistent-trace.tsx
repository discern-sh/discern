/** Reusable abstract artwork for the "Knowledge that compounds" benefit. */

interface PersistentTraceArtworkProps {
  /** Stable suffix keeps accessible SVG identifiers unique in a paired preview. */
  readonly id: string;
}

const TRACE_SEGMENTS = [
  "M 480 336 L 428 418 L 548 418",
  "M 548 418 L 480 306 L 374 456",
  "M 374 456 L 630 456 L 480 238",
  "M 480 238 L 316 496 L 700 496",
  "M 700 496 L 480 162 L 252 536",
  "M 252 536 L 776 536 L 480 82",
] as const;

const TRAVELER_ROUTE = TRACE_SEGMENTS.join(" ");

/**
 * Six plotted passes retain their earlier lines while one restrained accent
 * point traces the complete route. The resting SVG already contains the full
 * accumulated composition, so motion carries no essential information.
 */
export function PersistentTraceArtwork(
  { id }: PersistentTraceArtworkProps,
) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="persistent-trace">
      <svg
        className="persistent-trace__drawing"
        viewBox="0 0 960 640"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>Knowledge retained as geometric traces</title>
        <desc id={descriptionId}>
          Six plotted passes remain visible as they build a larger triangular
          pattern. A small blue point follows the newest pass.
        </desc>

        <g className="persistent-trace__construction" aria-hidden="true">
          <path d="M 480 72 L 186 548 L 774 548 Z" />
          <path d="M 480 72 L 480 548" />
          <path d="M 316 496 L 700 496" />
          <path d="M 374 456 L 630 456" />
          <path d="M 428 418 L 548 418" />
        </g>

        <g className="persistent-trace__durable" aria-hidden="true">
          {TRACE_SEGMENTS.map((path, index) => (
            <path
              d={path}
              data-persistent-layer={index + 1}
              key={path}
              pathLength={1}
            />
          ))}
        </g>

        <g className="persistent-trace__draw" aria-hidden="true">
          {TRACE_SEGMENTS.map((path, index) => (
            <path
              className={`persistent-trace__pass persistent-trace__pass--${
                index + 1
              }`}
              d={path}
              key={path}
              pathLength={1}
            />
          ))}
        </g>

        <g
          className="persistent-trace__origin"
          aria-hidden="true"
          transform="translate(480 336)"
        >
          <path d="M 0 -12 L -10 7 L 10 7 Z" />
          <path d="M 0 -12 L 10 7 L 0 7 Z" />
        </g>

        <circle
          className="persistent-trace__bloom"
          cx="480"
          cy="82"
          r="30"
          aria-hidden="true"
        />

        <g className="persistent-trace__traveler" aria-hidden="true">
          <circle className="persistent-trace__traveler-halo" r="10" />
          <circle className="persistent-trace__traveler-point" r="3.5" />
          <animateMotion
            dur="11s"
            repeatCount="indefinite"
            path={TRAVELER_ROUTE}
            keyPoints="0;1;1"
            keyTimes="0;0.82;1"
            calcMode="linear"
          />
        </g>
      </svg>
    </figure>
  );
}
