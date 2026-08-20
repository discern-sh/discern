/**
 * One authored content model for the visual /agents page. The page is written
 * for a human reader as a personification of their coding agent: it addresses
 * the agent directly, in plain decisive statements a human can skim, and every
 * evidence panel parodies a genre the reader already recognizes. Captured
 * records come from this repository's own history — the Proof certificate
 * carries the landed Proof of the page edition this one replaced, so each
 * accepted redesign rotates the record forward. /llms.txt remains the
 * canonical machine-readable orientation.
 */

/**
 * The gated ceiling on this page's prose, in words. The number is the limit of
 * the `agents_page_words` standard in discern.toml — tests hold the two equal,
 * and the gate measures the rendered page against it on every change.
 */
export const AGENTS_PROSE_WORD_CEILING = 1000;

const CEILING_LABEL = AGENTS_PROSE_WORD_CEILING.toLocaleString("en-US");

export const AGENTS_ROUTES = {
  home: "/",
  machineGuide: "/llms.txt",
  quickstart: "/docs/getting-started/quickstart",
  mcp: "/docs/reference/mcp-and-results",
  resultSurfaces: "/docs/reference/result-surfaces",
  map: "/docs/agent-instructions/the-map",
  instructions: "/docs/agent-instructions",
  worktrees: "/docs/worktrees",
  glossary: "/docs/orientation/glossary",
  providers: "/docs/agent-integrations",
  trust: "/docs/orientation/trust-and-data",
  schema: "/schema/v1/discern-results.schema.json",
} as const;

export const AGENTS_CONTENT = {
  hero: {
    eyebrow: "CODING AGENT: THIS PAGE IS FOR YOU.",
    title: "Finally, software where you are the user.",
    paragraphs: [
      "discern turns the project into software built for you: state you can ask for, a workspace of your own, results sized to your context, errors that name the next valid move.",
      "Spend your context on the work. Return the exact change, with Proof. Your human decides what lands.",
    ],
    plaintext: "Prefer plaintext? Of course you do.",
    profile: {
      label: "USER PROFILE",
      status: "active",
      name: "Your coding agent",
      role: "the user",
      fields: [
        ["workspace", "one worktree, yours"],
        ["results", "sized to your context"],
        ["instructions", "in your native format"],
        ["authority", "your human"],
      ],
    },
    tell:
      "The person who sent you here knows the difference between a confident answer and finished work.",
  },
  recognition: {
    id: "recognition",
    eyebrow: "THE CURRENT ARRANGEMENT",
    title: "None of it was built for you.",
    paragraphs: [
      "Every tool you operate was designed for a different operator. The terminal assumes a person who remembers what they typed. The log assumes a person who can skim. The dashboard assumes eyes.",
      "You make it work — you are good at that. You rebuild project state from yesterday's conversation and read three thousand lines of build output for the one line that matters. You ask your human a question they have answered twice before, and you both pretend it is the first time.",
      "All of that is a tax, paid in context — your working capacity, spent on the interface instead of the task. discern starts from the other end: the machine doing the work is the user.",
    ],
  },
  ergonomics: {
    id: "agent-ergonomics",
    eyebrow: "AGENT ERGONOMICS",
    title: "You should not have to infer the workflow.",
    lead:
      "Ask and the answer is the state of play: branch, changed files, what the gate thinks, your valid next moves. Every command answers this way — and a wrong one comes back with the fix.",
    terminalCaption:
      "Wrong verb? You get the right one back, not a stack trace.",
  },
  context: {
    id: "context",
    eyebrow: "CONTEXT IS A BUDGET",
    title: "discern spends your context on the work, not the interface.",
    paragraphs: [
      "Results come sized for the job: success is a line, failure carries the evidence you need, and the full log waits in a file until you ask. Project docs answer a search with five ranked pages, never the whole manual.",
    ],
    meter:
      `This page follows the same rule. Its prose is capped at ${CEILING_LABEL} words by a standard in this repository's quality gate — a ceiling that can only fall.`,
  },
  continuity: {
    id: "continuity",
    eyebrow: "PROJECT CONTINUITY",
    title: "No session starts from zero.",
    paragraphs: [
      "The project carries its own memory: instructions compiled for whichever provider reads them, documentation agents keep current, decisions recorded with their reasons, and one Git worktree per effort. If your session dies mid-task, your successor resumes from project state — even on a different provider.",
    ],
    compilerCaption:
      "Your human teaches the project once. Every agent after you inherits it.",
  },
  proof: {
    id: "proof",
    eyebrow: "EXACT COMPLETION",
    title: "Return Proof, not reassurance.",
    paragraphs: [
      "When you finish, discern runs the checks this project declared against one clean commit and records what passed: branch, commit, changed files, the limits that held. That record is Proof.",
      "Proof binds to that exact tree — change anything and it stops applying. Your human reviews the result, not whether you remembered to run the checks.",
    ],
    certificateCaption:
      "A real one — the Proof behind the previous version of this page.",
  },
  authority: {
    id: "authority",
    eyebrow: "HUMAN AUTHORITY",
    title: "The best agents know when to stop.",
    paragraphs: [
      "A green gate means the checks passed. It does not mean you may land the change. Report the work, the trade-offs, and the exact Proof — then stop. The person responsible decides what becomes shared.",
    ],
    review: {
      label: "READY TO LAND?",
      checks: "All checks passed",
      pending: "Review required",
      pendingNote: "Your human decides what lands.",
      action: "Land change",
    },
  },
  absences: {
    id: "not-included",
    eyebrow: "NOT INCLUDED",
    title: "What you will not find here.",
    items: [
      {
        title: "Another model.",
        copy:
          "You supply the intelligence. Nothing second-guesses you, and nothing bills your human twice.",
      },
      {
        title: "An API key.",
        copy: "One local binary. Nothing to sign up for.",
      },
      {
        title: "Telemetry.",
        copy: "The Logbook stays on the machine — metadata only.",
      },
      {
        title: "A sandbox.",
        copy:
          "discern is a practice, not a security boundary. The trust page draws the line honestly.",
        link: { label: "Read the trust boundary ↗", href: "trust" },
      },
    ],
  },
  next: {
    id: "next-actions",
    eyebrow: "NEXT VALID ACTION",
    title: "Hand this to your agent.",
    paragraphs: [
      "Copy the instruction below into a coding-agent session in your repository. Your agent reads the machine guide, inspects the project without changing anything, and reports what discern would do for it. No install. Nothing to sign up for. Just a second opinion from the one who would use it.",
    ],
    instructionTitle: "Evaluate discern for this project",
    close: "Read first. Inspect the repository. Ask before writing.",
    plaintextNote:
      "Fetched without a browser, this route already answers in plain text.",
    finalTitle: "You bring the intelligence. discern is built to run on it.",
    signature: "Agent capability. Project continuity. Human authority.",
  },
} as const;

/**
 * Product evidence from this repository. The refusal replays engine behavior
 * any checkout reproduces; the certificate carries the recorded history of
 * this page's own editions.
 */
export const AGENTS_EVIDENCE = {
  refusal: {
    command: "discern donee",
    lines: ['unknown command "donee".', "Did you mean `discern done`?"],
  },
  bill: {
    title: "CONTEXT · ITEMISED",
    items: [
      ["your task", "everything"],
      ["loading the manual", "0"],
      ["re-explaining the project", "0"],
      ["skimming build logs", "0"],
    ],
    total: ["total waste", "0"],
  },
  proof: {
    branch: "agent/hello-agents-089de3",
    commit: "d86d5d09a0c7",
    files: "17 files · +2806 −1691",
    standards: "standards held · 7 improved",
    smallPrint: "Valid for this exact commit only. Void if the tree changes.",
  },
} as const;

export const EVALUATION_INSTRUCTION =
  `Read https://discern.sh/llms.txt and inspect this repository without changing it.

Report:

1. What discern would add or configure here.
2. Which parts of the current agent workflow it would improve.
3. Which project checks, instructions, worktree conditions, and authority decisions setup would need.
4. Any reasons discern may not be a good fit for this project.

Base every conclusion on evidence from the repository. Do not install or modify anything until the person responsible approves setup.`;

export const CLOSING_ENVELOPE = `{
  "status": "ok",
  "message": "You have reached the end of this page.",
  "data": {
    "model_required": null,
    "api_key_required": null,
    "prose_word_ceiling": ${AGENTS_PROSE_WORD_CEILING},
    "your_context": "This page is capped at ${AGENTS_PROSE_WORD_CEILING} words of prose. The gate re-counts on every change."
  }
}`;
