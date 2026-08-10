/** Reusable abstract artwork for the benefit category "Multiply your output." */

export interface BifurcationArtworkProps {
  /** Prefix keeps the accessible SVG title and description unique per render. */
  readonly idPrefix: string;
}

/**
 * One seed separates into five held trajectories before resolving into the
 * filled-versus-empty triangle. Motion reveals the same complete static form.
 */
export function BifurcationArtwork(
  { idPrefix }: BifurcationArtworkProps,
) {
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <figure className="bifurcation-art">
      <svg
        viewBox="0 0 760 460"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>One trajectory becomes five, then one form</title>
        <desc id={descriptionId}>
          A single horizontal line divides into five calm curved trajectories.
          One pauses at a vertical threshold. All five meet the centre seam of a
          larger triangle whose right half is filled and left half remains open.
        </desc>

        <g aria-hidden="true">
          <ellipse
            className="bifurcation-art__bloom"
            data-bifurcation-motion
            cx="615"
            cy="252"
            rx="105"
            ry="126"
          />

          <g className="bifurcation-art__construction">
            <line
              className="bifurcation-art__baseline"
              x1="64"
              y1="375"
              x2="708"
              y2="375"
            />
            <line
              className="bifurcation-art__threshold"
              x1="386"
              y1="104"
              x2="386"
              y2="375"
            />
            <line x1="377" y1="104" x2="395" y2="104" />
            <line x1="377" y1="375" x2="395" y2="375" />
          </g>

          <path
            className="bifurcation-art__seed-line"
            data-bifurcation-motion
            d="M 72 238 C 116 238 158 238 204 238"
            pathLength="1"
          />
          <circle
            className="bifurcation-art__seed-point"
            data-bifurcation-motion
            cx="204"
            cy="238"
            r="3"
          />

          <g className="bifurcation-art__trajectories">
            <g data-bifurcation-trajectory="upper">
              <path
                className="bifurcation-art__route bifurcation-art__route--upper"
                data-bifurcation-motion
                d="M 204 238 C 278 238 288 144 386 144 C 470 144 526 149 596 149"
                pathLength="1"
              />
            </g>
            <g data-bifurcation-trajectory="upper-middle">
              <path
                className="bifurcation-art__route bifurcation-art__route--upper-middle"
                data-bifurcation-motion
                d="M 204 238 C 282 238 302 196 386 196 C 474 196 526 196 596 196"
                pathLength="1"
              />
            </g>
            <g data-bifurcation-trajectory="threshold">
              <path
                className="bifurcation-art__route bifurcation-art__route--threshold-in"
                data-bifurcation-motion
                d="M 204 238 C 278 238 318 238 386 238"
                pathLength="1"
              />
              <circle
                className="bifurcation-art__checkpoint"
                data-bifurcation-motion
                cx="386"
                cy="238"
                r="6"
              />
              <path
                className="bifurcation-art__route bifurcation-art__route--threshold-out"
                data-bifurcation-motion
                d="M 386 238 C 468 238 526 242 596 242"
                pathLength="1"
              />
            </g>
            <g data-bifurcation-trajectory="lower-middle">
              <path
                className="bifurcation-art__route bifurcation-art__route--lower-middle"
                data-bifurcation-motion
                d="M 204 238 C 282 238 302 289 386 289 C 476 289 530 289 596 289"
                pathLength="1"
              />
            </g>
            <g data-bifurcation-trajectory="lower">
              <path
                className="bifurcation-art__route bifurcation-art__route--lower"
                data-bifurcation-motion
                d="M 204 238 C 278 238 288 336 386 336 C 476 336 534 336 596 336"
                pathLength="1"
              />
            </g>
          </g>

          <g className="bifurcation-art__resolution">
            <path
              className="bifurcation-art__resolution-outline"
              data-bifurcation-motion
              d="M 596 92 L 694 375 L 498 375 Z"
              pathLength="1"
            />
            <polygon
              className="bifurcation-art__resolution-fill"
              data-bifurcation-motion
              points="596,92 694,375 596,375"
            />
            <path
              className="bifurcation-art__resolution-seam"
              data-bifurcation-motion
              d="M 596 92 L 596 375"
              pathLength="1"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
