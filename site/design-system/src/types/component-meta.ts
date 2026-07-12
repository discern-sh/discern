export type ComponentGroup =
  | "Core"
  | "Layout"
  | "Display"
  | "Forms"
  | "Feedback"
  | "Navigation";

export interface ComponentMeta {
  readonly name: string;
  readonly slug: string;
  readonly group: ComponentGroup;
  readonly order: number;
  readonly description: string;
  readonly accessibility?: readonly string[];
}
