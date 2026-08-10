/** Reusable abstract artwork for the benefit category "Multiply your output." */

export interface BifurcationArtworkProps {
  /** Prefix keeps the accessible SVG and reusable leaf-cap identifiers unique. */
  readonly idPrefix: string;
}

interface BifurcationPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

interface BifurcationNode extends BifurcationPoint {
  readonly parent: string;
  readonly accent: boolean;
}

/**
 * The single branching authority: every level doubles its parent's paths and
 * the final level defines the terminal cap positions.
 */
export const BIFURCATION_TOPOLOGY = {
  seed: { x: 58, y: 230 },
  root: { id: "root", x: 184, y: 230 },
  levels: [
    {
      depth: 1,
      nodes: [
        { id: "1a", parent: "root", x: 315, y: 135, accent: false },
        { id: "1b", parent: "root", x: 315, y: 325, accent: false },
      ],
    },
    {
      depth: 2,
      nodes: [
        { id: "2a", parent: "1a", x: 475, y: 89, accent: false },
        { id: "2b", parent: "1a", x: 475, y: 181, accent: false },
        { id: "2c", parent: "1b", x: 475, y: 279, accent: false },
        { id: "2d", parent: "1b", x: 475, y: 371, accent: false },
      ],
    },
    {
      depth: 3,
      nodes: [
        { id: "3a", parent: "2a", x: 650, y: 66, accent: false },
        { id: "3b", parent: "2a", x: 650, y: 112, accent: false },
        { id: "3c", parent: "2b", x: 650, y: 158, accent: false },
        { id: "3d", parent: "2b", x: 650, y: 204, accent: true },
        { id: "3e", parent: "2c", x: 650, y: 256, accent: false },
        { id: "3f", parent: "2c", x: 650, y: 302, accent: false },
        { id: "3g", parent: "2d", x: 650, y: 348, accent: false },
        { id: "3h", parent: "2d", x: 650, y: 394, accent: false },
      ],
    },
  ],
} as const;

/** Terminal nodes derive from the last declared level, never a copied list. */
const bifurcationTerminalLevel = BIFURCATION_TOPOLOGY.levels.at(-1);
if (bifurcationTerminalLevel === undefined) {
  throw new Error("Bifurcation topology requires at least one level");
}
export const BIFURCATION_TERMINALS = bifurcationTerminalLevel.nodes;
const BIFURCATION_TERMINAL_DEPTH = bifurcationTerminalLevel.depth;
const bifurcationTerminalIds = new Set<string>(
  BIFURCATION_TERMINALS.map((terminal) => terminal.id),
);

/**
 * One shared cap authority. The terminal registry point remains the semantic
 * branch destination; the mark sits slightly beyond it at every rendered size.
 */
export const BIFURCATION_TERMINAL_CAP = {
  size: 14,
  offsetX: 10,
} as const;

/** Meet the transparent triangle at its left edge, not beneath its empty half. */
function branchEndpoint(node: BifurcationNode): BifurcationPoint {
  if (!bifurcationTerminalIds.has(node.id)) return node;
  return {
    id: node.id,
    x: node.x + BIFURCATION_TERMINAL_CAP.offsetX -
      BIFURCATION_TERMINAL_CAP.size / 4,
    y: node.y,
  };
}

/** The one horizontal reveal span derives from all authored line geometry. */
const BIFURCATION_SWEEP_PADDING = 2;
const branchEndpoints = BIFURCATION_TOPOLOGY.levels.flatMap((level) =>
  level.nodes.map(branchEndpoint)
);
export const BIFURCATION_SWEEP = {
  startX: BIFURCATION_TOPOLOGY.seed.x - BIFURCATION_SWEEP_PADDING,
  endX: Math.max(...branchEndpoints.map((point) => point.x)) +
    BIFURCATION_SWEEP_PADDING,
} as const;
const BIFURCATION_SWEEP_WIDTH = BIFURCATION_SWEEP.endX -
  BIFURCATION_SWEEP.startX;

const topologyPoints: BifurcationPoint[] = [BIFURCATION_TOPOLOGY.root];
for (const level of BIFURCATION_TOPOLOGY.levels) {
  topologyPoints.push(...level.nodes);
}
const topologyPointById = new Map(
  topologyPoints.map((point) => [point.id, point]),
);

/** Join one child to its declared parent with calm horizontal tangents. */
function branchPath(node: BifurcationNode): string {
  const parent = topologyPointById.get(node.parent);
  if (parent === undefined) {
    throw new Error(`Unknown bifurcation parent: ${node.parent}`);
  }
  const endpoint = branchEndpoint(node);
  const distance = endpoint.x - parent.x;
  const firstControl = Math.round(parent.x + distance * 0.44);
  const secondControl = Math.round(endpoint.x - distance * 0.32);
  return `M ${parent.x} ${parent.y} C ${firstControl} ${parent.y} ${secondControl} ${endpoint.y} ${endpoint.x} ${endpoint.y}`;
}

/** Render one declared level; every node is one parent-to-child branch. */
function BifurcationLevel(
  { depth, nodes }: {
    readonly depth: number;
    readonly nodes: readonly BifurcationNode[];
  },
) {
  return (
    <g
      className="bifurcation-art__level"
      data-bifurcation-level={depth}
    >
      {nodes.map((node) => (
        <path
          className={node.accent
            ? "bifurcation-art__branch bifurcation-art__branch--accent"
            : "bifurcation-art__branch"}
          data-bifurcation-branch={node.id}
          data-bifurcation-parent={node.parent}
          d={branchPath(node)}
          key={node.id}
        />
      ))}
    </g>
  );
}

/**
 * A single line doubles through three sparse levels into eight marked leaves.
 * Motion reveals the same complete static tree one level at a time.
 */
export function BifurcationArtwork(
  { idPrefix }: BifurcationArtworkProps,
) {
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  const leafCapId = `${idPrefix}-leaf-cap`;
  const sweepClipId = `${idPrefix}-sweep-clip`;

  return (
    <figure className="bifurcation-art">
      <svg
        viewBox="0 0 760 460"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>One line multiplies into eight marked paths</title>
        <desc id={descriptionId}>
          A single horizontal seed divides into two paths, then four, then eight
          evenly distributed terminal paths. Each leaf ends in the same small
          up-pointing triangle with its right half filled.
        </desc>

        <defs>
          <symbol
            id={leafCapId}
            data-bifurcation-cap-symbol="leaf"
            viewBox="0 0 20 20"
          >
            <path
              className="bifurcation-art__cap-outline"
              d="M 10 0 L 20 20 L 0 20 Z"
            />
            <path
              className="bifurcation-art__cap-fill"
              d="M 10 0 L 20 20 L 10 20 Z"
            />
            <path className="bifurcation-art__cap-seam" d="M 10 0 L 10 20" />
          </symbol>
          <clipPath id={sweepClipId} clipPathUnits="userSpaceOnUse">
            <rect
              className="bifurcation-art__sweep-reveal"
              data-bifurcation-sweep-motion
              data-bifurcation-motion
              x={BIFURCATION_SWEEP.startX}
              y="0"
              width={BIFURCATION_SWEEP_WIDTH}
              height="460"
              style={{
                transformOrigin: `${BIFURCATION_SWEEP.startX}px center`,
              }}
            />
          </clipPath>
        </defs>

        <g aria-hidden="true">
          <g className="bifurcation-art__construction">
            <line x1="48" y1="230" x2="700" y2="230" />
            {[184, 315, 475, 650].map((x) => (
              <line x1={x} y1="225" x2={x} y2="235" key={x} />
            ))}
          </g>

          <g
            className="bifurcation-art__sweep-lines"
            data-bifurcation-sweep-lines
            data-bifurcation-motion
            clipPath={`url(#${sweepClipId})`}
          >
            <path
              className="bifurcation-art__seed-line"
              d={`M ${BIFURCATION_TOPOLOGY.seed.x} ${BIFURCATION_TOPOLOGY.seed.y} C 96 230 140 230 ${BIFURCATION_TOPOLOGY.root.x} ${BIFURCATION_TOPOLOGY.root.y}`}
            />

            <g className="bifurcation-art__branches">
              {BIFURCATION_TOPOLOGY.levels.map((level) => (
                <BifurcationLevel
                  depth={level.depth}
                  nodes={level.nodes}
                  key={level.depth}
                />
              ))}
            </g>
          </g>

          <g className="bifurcation-art__terminal-caps">
            {BIFURCATION_TERMINALS.map((terminal) => (
              <g
                data-bifurcation-terminal={terminal.id}
                data-bifurcation-level={BIFURCATION_TERMINAL_DEPTH + 1}
                transform={`translate(${
                  terminal.x + BIFURCATION_TERMINAL_CAP.offsetX
                } ${terminal.y})`}
                key={terminal.id}
              >
                <g
                  className="bifurcation-art__terminal-cap"
                  data-bifurcation-cap-motion
                  data-bifurcation-motion
                >
                  <use
                    href={`#${leafCapId}`}
                    x={-BIFURCATION_TERMINAL_CAP.size / 2}
                    y={-BIFURCATION_TERMINAL_CAP.size / 2}
                    width={BIFURCATION_TERMINAL_CAP.size}
                    height={BIFURCATION_TERMINAL_CAP.size}
                  />
                </g>
              </g>
            ))}
          </g>
        </g>
      </svg>
    </figure>
  );
}
