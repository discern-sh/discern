/** The homepage wall's data contract. Change it only by adding. */

export const CLUSTER_IDS = [
  "build-further",
  "return-human-attention",
  "know-what-is-ready",
  "make-improvement-accumulate",
  "keep-project-knowledge-working",
  "put-practice-in-place",
  "change-tools-without-starting-over",
  "keep-control",
] as const;
export type ClusterId = (typeof CLUSTER_IDS)[number];

/** Where a card's claim comes from, so a test can resolve `cites`. */
export type CardSource =
  | "human-benefit"
  | "agent-benefit"
  | "consequence"
  | "claim";

interface CardBase {
  /** Unique kebab-case id. A human-benefit card uses the benefit's registry id. */
  readonly id: string;
  readonly cluster: ClusterId;
  readonly source: CardSource;
  /** The registry id or claim slug this card expresses. */
  readonly cites: string;
  /** Optional second paragraph shown when the card is opened. One or two plain sentences. */
  readonly more?: string;
  /** Optional site path to a manual page that exists, such as "/docs/start". */
  readonly href?: string;
}
export interface BenefitCard extends CardBase {
  readonly kind: "benefit";
  readonly title: string;
  readonly line: string;
  /** Key into GLYPHS. Defaults to the card id. */
  readonly glyph?: string;
}
export interface StatementCard extends CardBase {
  readonly kind: "statement";
  readonly text: string;
}
export interface NumeralCard extends CardBase {
  readonly kind: "numeral";
  readonly numeral: string;
  readonly title: string;
  readonly line: string;
}
export type WallCard = BenefitCard | StatementCard | NumeralCard;

export interface WallLens {
  readonly id: string;
  /** Phrased as something the visitor wants, such as "Move more work". */
  readonly label: string;
  readonly clusters: readonly ClusterId[];
}
