/**
 * Source-backed Workflow projections for the browser manual.
 *
 * A directive is an HTML comment around ordinary Markdown:
 *
 *     <!-- discern-workflow:command -->
 *     ...complete, readable Markdown...
 *     <!-- /discern-workflow -->
 *
 * Raw and terminal readers keep the Markdown. The browser replaces only the
 * marked block with package-owned semantic HTML; no route registry repeats its
 * facts.
 */

import { packageManifest, semanticClass } from "discern-design-system";
import {
  escapeHtml,
  type MarkdownHtml,
  type MarkdownHtmlOptions,
  renderMarkdownHtml,
} from "../src/lib/markdown.ts";
import {
  WORKFLOW_DIRECTIVES,
  type WorkflowDirectiveId,
} from "./workflow_registry.ts";

const DIRECTIVE_START = /^<!-- discern-workflow:([a-z][a-z-]*) -->$/;
const DIRECTIVE_END = "<!-- /discern-workflow -->";
const PLACEHOLDER_LANGUAGE = "discern-workflow-projection";
const WORKFLOW_COMPONENT_IDS = new Set(
  packageManifest.components
    .filter((component) => component.group === "Workflow")
    .map((component) => component.id),
);

interface PreparedProjection<Model = unknown> {
  readonly id: string;
  readonly kind: WorkflowDirectiveId;
  readonly model: Model;
  readonly heading: boolean;
}

interface ProcedurePrerequisite {
  readonly requirement: string;
}

interface ProcedureStep {
  readonly title: string;
  readonly action: string;
}

interface ProcedureModel {
  readonly title: string;
  readonly description: string;
  readonly prerequisites: readonly ProcedurePrerequisite[];
  readonly steps: readonly ProcedureStep[];
  readonly completion: string;
}

interface CommandModel {
  readonly command: string;
  readonly workingDirectory?: string;
  readonly expectedResult: string;
  readonly failureNote?: string;
}

interface ResultSummaryModel {
  readonly fact: string;
  readonly nextAction: string;
}

interface ArtifactTableModel {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly pathColumn: number;
  readonly ownershipColumn: number;
}

interface BranchChoiceItem {
  readonly label: string;
  readonly path: string;
}

interface BranchChoiceModel {
  readonly title: string;
  readonly choices: readonly BranchChoiceItem[];
}

type ProjectionModel =
  | ProcedureModel
  | CommandModel
  | ResultSummaryModel
  | ArtifactTableModel
  | BranchChoiceModel;

type DirectiveParser = (body: string, source: string) => ProjectionModel;
type DirectiveRenderer = (
  model: ProjectionModel,
  options: MarkdownHtmlOptions,
  heading?: { readonly id: string; readonly html: string },
) => string;

/** Return the component class. */
function componentClass(
  component: string,
  element?: string,
  modifier?: string,
): string {
  if (!WORKFLOW_COMPONENT_IDS.has(component) && component !== "badge") {
    throw new Error(
      `site workflow renderer uses unknown component ${component}`,
    );
  }
  return semanticClass(component, {
    ...(element === undefined ? {} : { element }),
    ...(modifier === undefined ? {} : { modifier }),
  });
}

/** Trim the blank lines. */
function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Raise a failure. */
function fail(source: string, message: string): never {
  throw new Error(`docs workflow: ${source}: ${message}`);
}

/** Return the bold field. */
function boldField(
  line: string,
  source: string,
): { readonly label: string; readonly value: string } {
  const match = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(line);
  if (match?.[1] === undefined || match[2] === undefined) {
    fail(source, `expected a \`**Label:** value\` line, received ${line}`);
  }
  return { label: match[1], value: match[2] };
}

/** Return the inline HTML. */
function inlineHtml(
  markdown: string,
  options: MarkdownHtmlOptions,
  source = "inline projection",
): string {
  const rendered = renderMarkdownHtml(markdown, options);
  if (rendered.headings.length > 0) {
    fail(source, "inline Workflow content cannot contain a heading");
  }
  const match = /^<p>([\s\S]*)<\/p>$/.exec(rendered.html);
  if (match?.[1] === undefined) {
    fail(source, "inline Workflow content must be one Markdown paragraph");
  }
  return match[1];
}

/** Parse the procedure. */
function parseProcedure(body: string, source: string): ProcedureModel {
  const lines = trimBlankLines(body.split("\n"));
  const heading = /^##\s+(.+?)\s*$/.exec(lines[0] ?? "");
  if (heading?.[1] === undefined) {
    fail(source, "procedure must begin with an H2 title");
  }
  const beforeIndex = lines.findIndex((line) =>
    line.trim() === "**Before you start:**"
  );
  const stepsIndex = lines.findIndex((line) => line.trim() === "**Steps:**");
  const completionIndex = lines.findIndex((line) =>
    line.startsWith("**You are done when:**")
  );
  if (
    beforeIndex < 2 ||
    stepsIndex <= beforeIndex ||
    completionIndex <= stepsIndex
  ) {
    fail(
      source,
      "procedure needs a description, prerequisites, steps, and completion in order",
    );
  }

  const description = trimBlankLines(lines.slice(1, beforeIndex)).join("\n");
  if (description === "") fail(source, "procedure description is empty");

  const prerequisites = trimBlankLines(
    lines.slice(beforeIndex + 1, stepsIndex),
  ).map((line): ProcedurePrerequisite => {
    const item = /^- (?!\[[ xX]\]\s)(.+)$/.exec(line);
    if (item?.[1] === undefined) {
      fail(source, `invalid prerequisite line: ${line}`);
    }
    return { requirement: item[1] };
  });
  if (prerequisites.length === 0) {
    fail(source, "procedure has no prerequisites");
  }

  const steps = trimBlankLines(lines.slice(stepsIndex + 1, completionIndex))
    .map((line, index): ProcedureStep => {
      const item = /^(\d+)\.\s+\*\*(.+?)\.\*\*\s+(.+)$/.exec(line);
      if (
        item?.[1] === undefined ||
        item[2] === undefined ||
        item[3] === undefined
      ) {
        fail(source, `invalid procedure step: ${line}`);
      }
      if (Number(item[1]) !== index + 1) {
        fail(source, `procedure step ${item[1]} is out of sequence`);
      }
      return { title: item[2], action: item[3] };
    });
  if (steps.length === 0) fail(source, "procedure has no steps");

  const completion = boldField(lines[completionIndex] ?? "", source);
  if (completion.label !== "You are done when" || completion.value === "") {
    fail(source, "procedure completion must state when the reader is done");
  }
  if (
    trimBlankLines(lines.slice(completionIndex + 1)).length > 0
  ) {
    fail(source, "procedure has content after its completion");
  }
  return {
    title: heading[1],
    description,
    prerequisites,
    steps,
    completion: completion.value,
  };
}

/** Parse the command. */
function parseCommand(body: string, source: string): CommandModel {
  const lines = trimBlankLines(body.split("\n"));
  const opening = lines.findIndex((line) =>
    /^```(?:sh|bash|shell)$/.test(line)
  );
  if (opening < 0) fail(source, "command needs one sh code fence");
  const closing = lines.findIndex(
    (line, index) => index > opening && line === "```",
  );
  if (closing <= opening + 1) fail(source, "command code fence is empty");
  const command = lines.slice(opening + 1, closing).join("\n");

  const before = trimBlankLines(lines.slice(0, opening));
  let workingDirectory: string | undefined;
  if (before.length > 0) {
    if (before.length !== 1) fail(source, "command run context is ambiguous");
    const runIn = boldField(before[0] ?? "", source);
    if (runIn.label !== "Run in" || runIn.value === "") {
      fail(source, "command context must use `**Run in:**`");
    }
    workingDirectory = runIn.value.replace(/^`|`$/g, "");
  }

  const fields = trimBlankLines(lines.slice(closing + 1))
    .filter((line) => line.trim() !== "")
    .map((line) => boldField(line, source));
  const expected = fields.find((field) => field.label === "Expected result");
  const failure = fields.find((field) => field.label === "If this fails");
  if (expected === undefined || expected.value === "") {
    fail(source, "command needs `**Expected result:**`");
  }
  const known = new Set(["Expected result", "If this fails"]);
  const unknown = fields.find((field) => !known.has(field.label));
  if (unknown !== undefined) {
    fail(source, `unknown command field ${unknown.label}`);
  }
  return {
    command,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    expectedResult: expected.value,
    ...(failure === undefined ? {} : { failureNote: failure.value }),
  };
}

/** Parse the result summary. */
function parseResultSummary(body: string, source: string): ResultSummaryModel {
  const lines = trimBlankLines(body.split("\n")).filter((line) =>
    line.trim() !== ""
  );
  if (lines.length !== 2) {
    fail(source, "result summary needs one fact and one next action");
  }
  const fact = boldField(lines[0] ?? "", source);
  const next = boldField(lines[1] ?? "", source);
  if (fact.label !== "Failed" || fact.value === "") {
    fail(source, "result summary must begin with `**Failed:**`");
  }
  if (next.label !== "Next action" || next.value === "") {
    fail(source, "result summary must end with `**Next action:**`");
  }
  return { fact: fact.value, nextAction: next.value };
}

/** Split the table row. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/** Parse the artifact table. */
function parseArtifactTable(body: string, source: string): ArtifactTableModel {
  const lines = trimBlankLines(
    body.split("\n").filter((line) => !line.trim().startsWith("<!--")),
  );
  if (lines.length < 3) fail(source, "artifact projection needs a table");
  const headers = splitTableRow(lines[0] ?? "");
  const delimiter = splitTableRow(lines[1] ?? "");
  if (
    delimiter.length !== headers.length ||
    delimiter.some((cell) => !/^:?-{3,}:?$/.test(cell))
  ) {
    fail(source, "artifact table delimiter does not match its headers");
  }
  const pathColumn = headers.indexOf("Path");
  const ownershipColumn = headers.indexOf("Ownership");
  if (pathColumn < 0 || ownershipColumn < 0) {
    fail(source, "artifact table needs Path and Ownership columns");
  }
  const rows = lines.slice(2).map((line) => splitTableRow(line));
  if (rows.some((row) => row.length !== headers.length)) {
    fail(source, "artifact table row width does not match its headers");
  }
  if (rows.length === 0) fail(source, "artifact table has no rows");
  for (const row of rows) {
    const ownership = row[ownershipColumn]?.toLowerCase();
    if (
      ownership !== "authored" &&
      ownership !== "generated" &&
      ownership !== "project-owned" &&
      ownership !== "tool-owned"
    ) {
      fail(source, `unsupported artifact ownership ${row[ownershipColumn]}`);
    }
    if (!/^`[^`]+`$/.test(row[pathColumn] ?? "")) {
      fail(source, `artifact path must be inline code: ${row[pathColumn]}`);
    }
  }
  return { headers, rows, pathColumn, ownershipColumn };
}

/** Parse the branch choice. */
function parseBranchChoice(body: string, source: string): BranchChoiceModel {
  const lines = trimBlankLines(body.split("\n")).filter((line) =>
    line.trim() !== ""
  );
  const title = /^\*\*([^*]+)\*\*$/.exec(lines[0] ?? "")?.[1];
  if (title === undefined) {
    fail(source, "branch choice must begin with a bold title");
  }
  const choices = lines.slice(1).map((line): BranchChoiceItem => {
    const item = /^- \*\*([^*]+):\*\*\s+(.+)$/.exec(line);
    if (item?.[1] === undefined || item[2] === undefined) {
      fail(source, `invalid branch choice: ${line}`);
    }
    return { label: item[1], path: item[2] };
  });
  if (choices.length < 2) {
    fail(source, "branch choice needs at least 2 routes");
  }
  return { title, choices };
}

/** Render the procedure. */
function renderProcedure(
  model: ProcedureModel,
  options: MarkdownHtmlOptions,
  heading: { readonly id: string; readonly html: string },
): string {
  const prerequisites = model.prerequisites.map((item) =>
    `<li class="${
      componentClass("prerequisite-list", "item")
    }" data-discern-state="required">
      <span class="${
      componentClass("prerequisite-list", "marker")
    }" aria-hidden="true">•</span>
      <span class="${componentClass("prerequisite-list", "body")}">
        <span class="${componentClass("prerequisite-list", "requirement")}">${
      inlineHtml(item.requirement, options)
    }</span>
      </span>
      <span class="${
      componentClass("prerequisite-list", "state")
    }">Required</span>
    </li>`
  ).join("");
  const steps = model.steps.map((step) =>
    `<li class="${componentClass("procedure", "step")}">
      <article class="${componentClass("procedure-step")}">
        <header class="${componentClass("procedure-step", "header")}">
          <h3 class="${componentClass("procedure-step", "title")}">${
      inlineHtml(step.title, options)
    }</h3>
          <div class="${componentClass("procedure-step", "action")}">${
      inlineHtml(step.action, options)
    }</div>
        </header>
      </article>
    </li>`
  ).join("");
  return `<section class="${componentClass("procedure")}">
    <header class="${componentClass("procedure", "header")}">
      <h2 class="${componentClass("procedure", "title")}" id="${
    escapeHtml(heading.id)
  }">${heading.html}</h2>
      <div class="${componentClass("procedure", "description")}">${
    renderMarkdownHtml(model.description, options).html
  }</div>
    </header>
    <div class="${componentClass("procedure", "prerequisites")}">
      <div class="${componentClass("prerequisite-list")}">
        <div class="${
    componentClass("prerequisite-list", "title")
  }">Before you start</div>
        <ul class="${
    componentClass("prerequisite-list", "items")
  }">${prerequisites}</ul>
      </div>
    </div>
    <ol class="${componentClass("procedure", "steps")}">${steps}</ol>
    <footer class="${componentClass("procedure", "completion")}">
      <strong class="${
    componentClass("procedure", "completion-label")
  }">You are done when</strong>
      <div class="${componentClass("procedure", "completion-copy")}">${
    inlineHtml(model.completion, options)
  }</div>
    </footer>
  </section>`;
}

/** Render the command. */
function renderCommand(
  model: CommandModel,
  options: MarkdownHtmlOptions,
): string {
  const context = model.workingDirectory === undefined
    ? ""
    : `<div class="${componentClass("command", "context")}">
      <span class="${componentClass("command", "context-item")}">
        <span class="${
      componentClass("command", "context-label")
    }">Run in</span>
        <code>${escapeHtml(model.workingDirectory)}</code>
      </span>
    </div>`;
  const failure = model.failureNote === undefined
    ? ""
    : `<div class="${componentClass("command", "failure-note")}">
      <strong>If this fails</strong>
      <span>${inlineHtml(model.failureNote, options)}</span>
    </div>`;
  return `<figure class="${componentClass("command")}">
    ${context}
    <div class="${componentClass("command", "execution")}">
      <pre class="${componentClass("command", "text")}" tabindex="0"><code>${
    escapeHtml(model.command)
  }</code></pre>
    </div>
    <figcaption class="${componentClass("command", "details")}">
      <div class="${componentClass("expected-result")} ${
    componentClass("expected-result", undefined, "state")
  }">
        <span class="${
    componentClass("expected-result", "label")
  }">Expected result</span>
        <div class="${componentClass("expected-result", "state")}">${
    inlineHtml(model.expectedResult, options)
  }</div>
      </div>
      ${failure}
    </figcaption>
  </figure>`;
}

/** Render the result summary. */
function renderResultSummary(
  model: ResultSummaryModel,
  options: MarkdownHtmlOptions,
): string {
  return `<article class="${componentClass("result-summary")}">
    <header class="${componentClass("result-summary", "header")}">
      <span class="${
    componentClass("result-summary", "state")
  }" data-discern-state="failed">Failed</span>
      <div class="${componentClass("result-summary", "fact")}">${
    inlineHtml(model.fact, options)
  }</div>
    </header>
    <div class="${componentClass("result-summary", "next")}">
      <strong>Next action</strong>
      <div>${inlineHtml(model.nextAction, options)}</div>
    </div>
  </article>`;
}

/** Split the path. */
function splitPath(path: string): readonly [string, string] {
  const trailingSeparator = /[\\/]$/.test(path);
  const searchFrom = trailingSeparator ? path.length - 2 : path.length - 1;
  const separator = Math.max(
    path.lastIndexOf("/", searchFrom),
    path.lastIndexOf("\\", searchFrom),
  );
  return separator < 0
    ? ["", path]
    : [path.slice(0, separator + 1), path.slice(separator + 1)];
}

/** Return the path reference. */
function pathReference(path: string): string {
  const [prefix, suffix] = splitPath(path);
  return `<span class="${componentClass("path-reference")}">
    <code class="${componentClass("path-reference", "path")}" title="${
    escapeHtml(path)
  }">
      <span class="discern-visually-hidden">${escapeHtml(path)}</span>
      ${
    prefix === ""
      ? ""
      : `<span class="${
        componentClass("path-reference", "prefix")
      }" aria-hidden="true">${escapeHtml(prefix)}</span>`
  }
      <span class="${
    componentClass("path-reference", "suffix")
  }" aria-hidden="true">${escapeHtml(suffix)}</span>
    </code>
  </span>`;
}

/** Return the ownership badge. */
function ownershipBadge(value: string): string {
  const ownership = value.toLowerCase();
  return `<span class="${componentClass("badge")} ${
    componentClass("badge", undefined, "neutral")
  } ${componentClass("ownership-badge")}" data-discern-ownership="${
    escapeHtml(ownership)
  }">${escapeHtml(value)}</span>`;
}

/** Render the artifact table. */
function renderArtifactTable(
  model: ArtifactTableModel,
  options: MarkdownHtmlOptions,
): string {
  const head = model.headers.map((header) =>
    `<th>${inlineHtml(header, options)}</th>`
  ).join("");
  const rows = model.rows.map((row) =>
    `<tr>${
      row.map((cell, index) => {
        if (index === model.pathColumn) {
          return `<td>${pathReference(cell.slice(1, -1))}</td>`;
        }
        if (index === model.ownershipColumn) {
          return `<td>${ownershipBadge(cell)}</td>`;
        }
        return `<td>${inlineHtml(cell, options)}</td>`;
      }).join("")
    }</tr>`
  ).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** Render the branch choice. */
function renderBranchChoice(
  model: BranchChoiceModel,
  options: MarkdownHtmlOptions,
): string {
  const choices = model.choices.map((choice) =>
    `<li class="${componentClass("branch-choice", "choice")}">
      <span class="${componentClass("branch-choice", "label")}">${
      inlineHtml(choice.label, options)
    }</span>
      <ul class="${componentClass("branch-choice", "paths")}">
        <li class="${componentClass("branch-choice", "path")}"><span>${
      inlineHtml(choice.path, options)
    }</span></li>
      </ul>
    </li>`
  ).join("");
  return `<div class="${
    componentClass("branch-choice")
  }" role="group" aria-label="${escapeHtml(model.title)}">
    <div class="${componentClass("branch-choice", "title")}">${
    inlineHtml(model.title, options)
  }</div>
    <ul class="${componentClass("branch-choice", "choices")}">${choices}</ul>
  </div>`;
}

const PARSERS = {
  procedure: parseProcedure,
  command: parseCommand,
  "result-summary": parseResultSummary,
  "artifact-ownership": parseArtifactTable,
  "branch-choice": parseBranchChoice,
} as const satisfies Record<WorkflowDirectiveId, DirectiveParser>;

const RENDERERS = {
  procedure: (
    model,
    options,
    heading,
  ) => {
    if (heading === undefined) {
      throw new Error("docs workflow: procedure lost its heading");
    }
    return renderProcedure(model as ProcedureModel, options, heading);
  },
  command: (model, options) => renderCommand(model as CommandModel, options),
  "result-summary": (model, options) =>
    renderResultSummary(model as ResultSummaryModel, options),
  "artifact-ownership": (model, options) =>
    renderArtifactTable(model as ArtifactTableModel, options),
  "branch-choice": (model, options) =>
    renderBranchChoice(model as BranchChoiceModel, options),
} as const satisfies Record<WorkflowDirectiveId, DirectiveRenderer>;

/** Return the directive id. */
function directiveId(value: string, source: string): WorkflowDirectiveId {
  const definition = WORKFLOW_DIRECTIVES.find((entry) => entry.id === value);
  if (definition === undefined) fail(source, `unknown directive ${value}`);
  return definition.id;
}

/** Return the placeholder. */
function placeholder(id: string): string {
  return `\`\`\`${PLACEHOLDER_LANGUAGE}\n${id}\n\`\`\``;
}

/** Prepare the workflow markdown. */
function prepareWorkflowMarkdown(
  markdown: string,
  source: string,
): {
  readonly markdown: string;
  readonly projections: readonly PreparedProjection<ProjectionModel>[];
} {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  const projections: PreparedProjection<ProjectionModel>[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === DIRECTIVE_END) {
      fail(source, "closing directive has no opener");
    }
    const start = DIRECTIVE_START.exec(line.trim());
    if (start?.[1] === undefined) {
      output.push(line);
      continue;
    }
    const kind = directiveId(start[1], source);
    const body: string[] = [];
    let closed = false;
    for (index += 1; index < lines.length; index += 1) {
      const bodyLine = lines[index] ?? "";
      if (DIRECTIVE_START.test(bodyLine.trim())) {
        fail(source, "Workflow directives cannot nest");
      }
      if (bodyLine.trim() === DIRECTIVE_END) {
        closed = true;
        break;
      }
      body.push(bodyLine);
    }
    if (!closed) fail(source, `${kind} directive has no closing marker`);
    const id = `discern-workflow-projection-${projections.length}`;
    const model = PARSERS[kind](body.join("\n"), source);
    const heading = kind === "procedure";
    projections.push({ id, kind, model, heading });
    if (heading) {
      output.push(`## ${(model as ProcedureModel).title}`, "", placeholder(id));
    } else {
      output.push(placeholder(id));
    }
  }
  return { markdown: output.join("\n"), projections };
}

/** Return the placeholder HTML. */
function placeholderHtml(id: string): string {
  return `<pre><code class="language-${PLACEHOLDER_LANGUAGE}">${id}</code></pre>`;
}

/** Replace the procedure. */
function replaceProcedure(
  html: string,
  projection: PreparedProjection<ProjectionModel>,
  options: MarkdownHtmlOptions,
): string {
  const target = placeholderHtml(projection.id);
  const placeholderIndex = html.indexOf(target);
  if (placeholderIndex < 0) {
    throw new Error(`docs workflow: lost placeholder ${projection.id}`);
  }
  const before = html.slice(0, placeholderIndex);
  const headingStart = before.lastIndexOf("<h2 ");
  if (headingStart < 0) {
    throw new Error(`docs workflow: ${projection.id} lost its H2`);
  }
  const headingMarkup = before.slice(headingStart).trimEnd();
  const heading = /^<h2 id="([^"]+)">([\s\S]+)<\/h2>$/.exec(headingMarkup);
  if (heading?.[1] === undefined || heading[2] === undefined) {
    throw new Error(`docs workflow: ${projection.id} has malformed H2`);
  }
  const replacement = RENDERERS[projection.kind](
    projection.model,
    options,
    { id: heading[1], html: heading[2] },
  );
  return `${before.slice(0, headingStart)}${replacement}${
    html.slice(placeholderIndex + target.length)
  }`;
}

/**
 * Render Markdown and apply every explicit Workflow projection. Unknown,
 * nested, malformed, or unmatched directives fail the page build.
 */
export function renderWorkflowMarkdown(
  markdown: string,
  options: MarkdownHtmlOptions = {},
  source = "Markdown",
): MarkdownHtml {
  const prepared = prepareWorkflowMarkdown(markdown, source);
  const rendered = renderMarkdownHtml(prepared.markdown, options);
  let html = rendered.html;
  for (const projection of prepared.projections) {
    if (projection.heading) {
      html = replaceProcedure(html, projection, options);
      continue;
    }
    const target = placeholderHtml(projection.id);
    if (!html.includes(target)) {
      throw new Error(`docs workflow: lost placeholder ${projection.id}`);
    }
    html = html.replace(
      target,
      RENDERERS[projection.kind](projection.model, options, undefined),
    );
  }
  return { html, headings: rendered.headings };
}
