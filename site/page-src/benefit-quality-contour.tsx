/** Reusable one-way contour artwork for the quality-retention benefit. */

import type { ReactNode } from "react";

export interface QualityContourArtworkProps {
  /** Unique prefix for the accessible SVG title and description. */
  readonly idPrefix: string;
}

const LATEST_CONTOUR =
  "M 421 231 C 417 216 422 201 438 188 C 454 175 478 176 496 187 C 509 194 512 210 505 224 C 497 239 478 242 460 239 C 445 237 426 234 421 231 Z";

/**
 * Six retained boundaries converge on discern's half-filled triangle.
 * Motion only traces the latest boundary; the accumulated form is permanent.
 */
export function QualityContourArtwork(
  { idPrefix }: QualityContourArtworkProps,
): ReactNode {
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <figure className="quality-contour">
      <svg
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>One-way contour of retained quality</title>
        <desc id={descriptionId}>
          Six irregular retained boundaries narrow toward a half-filled
          triangle. Earlier boundaries remain faint while the newest boundary is
          blue.
        </desc>

        <g aria-hidden="true">
          <circle
            className="quality-contour__bloom"
            cx="467"
            cy="205"
            r="74"
          />

          <g className="quality-contour__retained">
            <path
              className="quality-contour__line quality-contour__line--01"
              d="M 92 421 C 58 330 82 199 181 108 C 278 19 447 29 586 111 C 680 166 707 291 653 391 C 596 496 441 515 287 483 C 187 462 117 442 92 421 Z"
            />
            <path
              className="quality-contour__line quality-contour__line--02"
              d="M 153 389 C 128 313 151 214 230 142 C 309 70 440 78 548 141 C 621 184 641 280 597 358 C 551 441 430 456 311 432 C 230 416 174 402 153 389 Z"
            />
            <path
              className="quality-contour__line quality-contour__line--03"
              d="M 218 354 C 200 294 219 222 280 167 C 342 111 440 116 521 163 C 575 195 590 264 558 322 C 524 384 436 394 350 378 C 289 366 236 360 218 354 Z"
            />
            <path
              className="quality-contour__line quality-contour__line--04"
              d="M 290 314 C 278 270 291 224 334 186 C 377 148 442 150 495 181 C 531 202 541 249 520 287 C 497 329 438 335 383 326 C 342 320 302 318 290 314 Z"
            />
            <path
              className="quality-contour__line quality-contour__line--05"
              d="M 362 271 C 355 244 364 218 392 194 C 420 171 460 173 493 192 C 515 205 521 232 508 255 C 493 281 457 285 426 280 C 400 276 371 274 362 271 Z"
            />
            <path
              className="quality-contour__line quality-contour__line--latest"
              d={LATEST_CONTOUR}
            />
          </g>

          <path
            className="quality-contour__trace"
            d={LATEST_CONTOUR}
            pathLength={1}
          />

          <g className="quality-contour__attractor">
            <path
              className="quality-contour__attractor-fill"
              d="M 467 184 L 467 226 L 490 226 Z"
            />
            <path
              className="quality-contour__attractor-outline"
              d="M 467 184 L 444 226 L 490 226 Z"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
