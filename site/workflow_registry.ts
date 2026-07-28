/** Workflow projections the browser manual understands. */

import { packageManifest } from "discern-design-system";

export interface WorkflowDirectiveDefinition {
  readonly id: string;
  /** Public package components this projection renders as roots. */
  readonly components: readonly string[];
}

/**
 * Markdown carries the facts; these directives name the browser presentation
 * applied to a marked block. Tests hold every member to one renderer, one
 * source example, and the emitted package selection.
 */
export const WORKFLOW_DIRECTIVES = [
  { id: "procedure", components: ["procedure"] },
  { id: "command", components: ["command"] },
  { id: "result-summary", components: ["result-summary"] },
  {
    id: "artifact-ownership",
    components: ["path-reference", "ownership-badge"],
  },
  { id: "branch-choice", components: ["branch-choice"] },
] as const satisfies readonly WorkflowDirectiveDefinition[];

export type WorkflowDirectiveId = (typeof WORKFLOW_DIRECTIVES)[number]["id"];

const requestedWorkflowComponents = new Set<string>(
  WORKFLOW_DIRECTIVES.flatMap((directive) => directive.components),
);

for (const id of requestedWorkflowComponents) {
  const component = packageManifest.components.find((entry) => entry.id === id);
  if (component === undefined || component.group !== "Workflow") {
    throw new Error(
      `site workflow directive selects missing Workflow component ${id}`,
    );
  }
}

/**
 * Requested components in the package manifest's canonical order. The package
 * emitter owns dependency closure.
 */
export const WORKFLOW_COMPONENTS: readonly string[] = packageManifest.components
  .filter((component) => requestedWorkflowComponents.has(component.id))
  .map((component) => component.id);
