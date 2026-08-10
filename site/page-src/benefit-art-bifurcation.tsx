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
  const distance = node.x - parent.x;
  const firstControl = Math.round(parent.x + distance * 0.44);
  const secondControl = Math.round(node.x - distance * 0.32);
  return `M ${parent.x} ${parent.y} C ${firstControl} ${parent.y} ${secondControl} ${node.y} ${node.x} ${node.y}`;
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
          data-bifurcation-motion
          d={branchPath(node)}
          pathLength="1"
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
        </defs>

        <g aria-hidden="true">
          <g className="bifurcation-art__construction">
            <line x1="48" y1="230" x2="700" y2="230" />
            {[184, 315, 475, 650].map((x) => (
              <line x1={x} y1="225" x2={x} y2="235" key={x} />
            ))}
          </g>

          <path
            className="bifurcation-art__seed-line"
            data-bifurcation-motion
            d={`M ${BIFURCATION_TOPOLOGY.seed.x} ${BIFURCATION_TOPOLOGY.seed.y} C 96 230 140 230 ${BIFURCATION_TOPOLOGY.root.x} ${BIFURCATION_TOPOLOGY.root.y}`}
            pathLength="1"
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

          <g className="bifurcation-art__terminal-caps">
            {BIFURCATION_TERMINALS.map((terminal) => (
              <g
                data-bifurcation-terminal={terminal.id}
                data-bifurcation-level={BIFURCATION_TERMINAL_DEPTH + 1}
                transform={`translate(${terminal.x} ${terminal.y})`}
                key={terminal.id}
              >
                <g
                  className="bifurcation-art__terminal-cap"
                  data-bifurcation-cap-motion
                  data-bifurcation-motion
                >
                  <use
                    href={`#${leafCapId}`}
                    x="-10"
                    y="-10"
                    width="20"
                    height="20"
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
