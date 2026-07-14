export const componentGroups = [
  "Core",
  "Layout",
  "Display",
  "Forms",
  "Feedback",
  "Navigation",
  "Marketing",
] as const;

export type ComponentGroup = (typeof componentGroups)[number];

export interface ComponentMeta {
  readonly name: string;
  readonly slug: string;
  readonly group: ComponentGroup;
  readonly order: number;
  readonly description: string;
  readonly accessibility?: readonly string[];
}
