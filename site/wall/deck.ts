/**
 * The wall's cards.
 *
 * Cards are authored by cluster, in the benefit canon's order, so the copy for
 * one family of outcomes reads together. `WALL_DECK` is the same set in display
 * order: clusters scattered through one another, with the statement and
 * numeral cards spaced through the benefit cards. Every card cites the
 * registry entry it expresses.
 */
import {
  AGENT_NAMES,
  agentLabelForNative,
} from "../../src/shared/agent_catalogue.ts";
import type { WallCard, WallLens } from "./types.ts";

/** The coding agents discern supports, by display name, in catalogue order. */
const SUPPORTED_AGENTS: readonly string[] = AGENT_NAMES.map(
  agentLabelForNative,
);

/**
 * How many quality limits discern's own repository holds: its `[standards.*]`
 * tables in `discern.toml`. This module also runs in the browser, where that
 * file cannot be read, so the deck test holds this number equal to the count.
 */
const OWN_QUALITY_LIMITS = 36;

/** Names as a sentence would list them: "A", "A and B", or "A, B, and C". */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  const rest = names.slice(0, -1);
  if (rest.length < 2) return [...rest, last].join(" and ");
  return `${rest.join(", ")}, and ${last}`;
}

const CARDS = [
  {
    kind: "benefit",
    id: "shape-substantial-work",
    cluster: "build-further",
    source: "human-benefit",
    cites: "shape-substantial-work",
    title: "Hand off bigger goals",
    line: "Turn one big goal into complete briefs your agents can run with.",
    more:
      "Your agent finds the natural seams in the work and writes each brief to stand alone. Run the pieces side by side, or in stages when one depends on another.",
    href: "/docs/guides/delegate-work",
  },
  {
    kind: "benefit",
    id: "parallel-work-on-one-machine",
    cluster: "build-further",
    source: "human-benefit",
    cites: "parallel-work-on-one-machine",
    title: "Many agents, one machine",
    line: "Run agents in parallel, each in its own copy of your project.",
    more:
      "Every task gets its own folder and branch, plus its own ports and databases where you've declared them. If two tasks edit the same file, discern points out the overlap before the work comes together.",
    href: "/docs/guides/coordinate-parallel-tasks",
  },
  {
    kind: "benefit",
    id: "wait-without-relay",
    cluster: "build-further",
    source: "human-benefit",
    cites: "wait-without-relay",
    title: "Stop playing messenger",
    line: "Agents wait for each other's work, then carry on without a nudge.",
    more:
      "A task can pause until another passes its tests or joins your main branch, then carry on by itself.",
    href: "/docs/guides/wait-for-another-task",
  },
  {
    kind: "benefit",
    id: "compose-staged-work",
    cluster: "build-further",
    source: "human-benefit",
    cites: "compose-staged-work",
    title: "Build on pending work",
    line: "Start the next task on top of work you haven't merged yet.",
    more:
      "A follow-up can begin from an earlier task's tested commit while that one waits for your approval. Each task still merges only when you say so.",
    href: "/docs/guides/coordinate-parallel-tasks",
  },
  {
    kind: "benefit",
    id: "land-finished-work-as-the-project-moves",
    cluster: "build-further",
    source: "human-benefit",
    cites: "land-finished-work-as-the-project-moves",
    title: "Merge in any order",
    line:
      "When something else merges first, your finished work doesn't start over.",
    more:
      "A temporary copy combines both changes, your tests run on the result, and only what passed merges. A real conflict goes back to the agent that wrote the change.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "resume-later",
    cluster: "build-further",
    source: "human-benefit",
    cites: "resume-later",
    title: "Walk away mid-task",
    line: "Leave a task half done and resume it in a new session.",
    more:
      "The task's folder, branch, and setup stay where you left them. A new session asks discern where things stand and gets the next step.",
    href: "/docs/guides/recover-an-interrupted-task",
  },
  {
    kind: "benefit",
    id: "agent-resume-after-interruption",
    cluster: "build-further",
    source: "agent-benefit",
    cites: "resume-after-interruption",
    title: "Reconnect to a run",
    line: "A dropped connection doesn't have to cost you a second test run.",
    more:
      "Long runs record their progress and keep their final result. If your agent loses track of one, it reads that record back instead of starting over.",
    href: "/docs/guides/recover-an-interrupted-task",
  },
  {
    kind: "statement",
    id: "statement-parallel-by-default",
    cluster: "build-further",
    source: "consequence",
    cites: "parallel-by-default",
    text: "Parallel stops being a special occasion.",
    more:
      "Every task gets its own copy of the project, so starting a third takes no more setup than starting the first. The work still has to split along real seams.",
    href: "/docs/guides/coordinate-parallel-tasks",
  },
  {
    kind: "statement",
    id: "statement-cheap-failure-buys-bold-work",
    cluster: "build-further",
    source: "consequence",
    cites: "cheap-failure-buys-bold-work",
    text: "Start the big change you keep putting off.",
    more:
      "A failed attempt stays on its own branch, away from your main one. Throw it away, or run several approaches and keep the best.",
    href: "/docs/understand/worktrees-and-trunk",
  },

  {
    kind: "benefit",
    id: "reduce-routine-review",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "reduce-routine-review",
    title: "Review what matters",
    line:
      "Stop checking whether the tests ran, and review what the change does.",
    more:
      "Each finished change arrives with a record of which of your project's commands passed. Your attention can go to behavior, design, and risk.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "judgment-at-the-change",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "judgment-at-the-change",
    title: "Your questions, built in",
    line:
      "Agents answer your review questions whenever they change the files you flag.",
    more:
      "Write a question once, such as whether a database change can be undone, and choose the files that trigger it. The answer goes on record as the agent's judgment, and an unmet one waits for you.",
    href: "/docs/understand/checkpoints",
  },
  {
    kind: "benefit",
    id: "decisions-in-one-view",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "decisions-in-one-view",
    title: "See what needs you",
    line: "One screen shows every task and which ones are waiting on you.",
    more:
      "Run discern in your project folder to open the desk, a view of your tasks sorted by what each needs from you. There's no need to visit every session to ask how it's going.",
    href: "/docs/guides/coordinate-parallel-tasks",
  },
  {
    kind: "benefit",
    id: "useful-failures-sooner",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "useful-failures-sooner",
    title: "Failures you can use",
    line:
      "Every failure comes with its output and the command to reproduce it.",
    more:
      "A run stops early once a failure makes the rest pointless, and you hear about a stalled one instead of waiting on it. Your agent goes straight to the cause.",
    href: "/docs/guides/fix-a-red-gate",
  },
  {
    kind: "benefit",
    id: "catch-related-files",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "catch-related-files",
    title: "Catch the forgotten file",
    line: "Know when a change skips a file that usually goes with it.",
    more:
      "Your project's history shows which files tend to change together, such as a module and its test. The nudge is a hint drawn from habit, so you and your agent judge whether it applies.",
    href: "/docs/guides/improve-the-practice",
  },
  {
    kind: "benefit",
    id: "run-relevant-checks",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "run-relevant-checks",
    title: "Only the checks needed",
    line: "A docs-only check, like a link checker, runs only when docs change.",
    more:
      "You name an area of your project and the check it needs. Your tests and other everyday commands still run on every change.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "context-for-the-task",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "context-for-the-task",
    title: "Room to think",
    line: "Brief, focused output keeps your agent's attention on your code.",
    more:
      "An agent can hold only so much in mind at once, so discern keeps its output brief and offers advice only when it applies.",
    href: "/docs/start/how-discern-works",
  },
  {
    kind: "statement",
    id: "statement-the-job-moves-up-a-level",
    cluster: "return-human-attention",
    source: "consequence",
    cites: "the-job-moves-up-a-level",
    text: "Your job moves up a level.",
    more:
      "The work comes back finished. What's left is the part only you can do.",
    href: "/docs/guides/delegate-work",
  },
  {
    kind: "statement",
    id: "statement-review-grows-slower-than-output",
    cluster: "return-human-attention",
    source: "consequence",
    cites: "review-grows-slower-than-output",
    text: "More work comes back than you have to read.",
    more:
      "Routine checking happens before a change reaches you, and you can give routine approvals in advance. How deeply you review still depends on the change.",
    href: "/docs/guides/finish-and-land-a-change",
  },

  {
    kind: "benefit",
    id: "project-defined-completion",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "project-defined-completion",
    title: "Finished means tested",
    line:
      "Work counts as finished only when your tests, linter, and build pass.",
    more:
      "You choose the commands that define finished: your formatter, linter, build, tests, and anything else. A change isn't reported as done until they all pass.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "evidence-for-this-change",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "evidence-for-this-change",
    title: "Proof of what passed",
    line:
      "Every finished change shows which tests passed, and on which exact commit.",
    more:
      "That record, a Proof, names the commit it covers. Edit the code afterward and that Proof no longer applies.",
    href: "/docs/understand/proof",
  },
  {
    kind: "benefit",
    id: "evidence-that-lasts",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "evidence-that-lasts",
    title: "A record that lasts",
    line: "Months later, look up what a change passed before it merged.",
    more:
      "When a change merges, its record stays with that commit in your Git history. It outlives the task's folder and the agent's session.",
    href: "/docs/understand/proof",
  },
  {
    kind: "benefit",
    id: "explicit-release-decision",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "explicit-release-decision",
    title: "You decide what ships",
    line: "Rapidly iterate on new features and experiments with confidence.",
    more:
      "A change merges only with your go-ahead, or under a permission you set up in advance. Until then, finished work waits for you with its tests already passed.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "bounded-standing-permission",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "bounded-standing-permission",
    title: "Pre-approve the routine",
    line:
      "Let routine changes, like docs fixes, merge without waiting for you.",
    more:
      "Name the areas you're happy to wave through, such as documentation. A change that touches any file outside them still comes to you.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "unfinished-work-stays-isolated",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "unfinished-work-stays-isolated",
    title: "Main stays clean",
    line:
      "An agent can try, fail, and retry without touching your main branch.",
    more:
      "Each task lives on its own branch in its own folder. Your main branch changes only when you accept a finished result.",
    href: "/docs/understand/worktrees-and-trunk",
  },
  {
    kind: "benefit",
    id: "recover-interrupted-operations",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "recover-interrupted-operations",
    title: "Preview before it runs",
    line: "See what discern will change before it touches your project.",
    more:
      "Ask for a dry run to see the plan with nothing applied. If a command stops partway, discern keeps enough state to resume or repair it.",
    href: "/docs/understand/local-control",
  },
  {
    kind: "benefit",
    id: "agent-carry-judgment-as-judgment",
    cluster: "know-what-is-ready",
    source: "agent-benefit",
    cites: "carry-judgment-as-judgment",
    title: "Opinion marked as opinion",
    line: "See what was tested and what is only your agent's opinion.",
    more:
      "An agent's answer to a review question sits apart from the pass and fail results. Opinion never passes for tested fact.",
    href: "/docs/understand/checkpoints",
  },
  {
    kind: "statement",
    id: "statement-ci-confirms-what-you-know",
    cluster: "know-what-is-ready",
    source: "consequence",
    cites: "ci-confirms-what-you-know",
    text: "By the time CI runs, you already know.",
    more:
      "Your tests and other commands run on your machine before you share anything. CI then confirms a result you've already seen.",
    href: "/docs/guides/run-the-gate-in-ci",
  },

  {
    kind: "benefit",
    id: "retain-measured-gains",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "retain-measured-gains",
    title: "Gains that stick",
    line: "Set a bar, like test coverage, that agents can't lower to pass.",
    more:
      "Every change has to meet the limit on your main branch. Moving a limit the wrong way takes your approval.",
    href: "/docs/understand/standards",
  },
  {
    kind: "benefit",
    id: "pin-new-baseline",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "pin-new-baseline",
    title: "Lock in the win",
    line: "Make today's better number the limit every later change must meet.",
    more:
      "When a measure improves, one command sets the new value as the limit. From then on, the project starts from the better number.",
    href: "/docs/guides/set-and-raise-standards",
  },
  {
    kind: "benefit",
    id: "standards-that-scale",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "standards-that-scale",
    title: "Limits for any metric",
    line:
      "Limit bundle size, lint warnings, or any number a command can print.",
    more:
      "Slow tests, duplicated code, download size: if a command can print the number, it can become a limit. A limit can be a rate, so it keeps pace as the codebase grows.",
    href: "/docs/understand/standards",
  },
  {
    kind: "benefit",
    id: "remove-bug-class",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "remove-bug-class",
    title: "Bugs fixed for good",
    line: "Fix a bug everywhere it lives and guard against its return.",
    more:
      "A built-in playbook has your agent prove the cause, fix every instance, and add a test or lint rule that fails if the bug comes back.",
    href: "/docs/guides/create-and-manage-skills",
  },
  {
    kind: "benefit",
    id: "retire-old-pattern",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "retire-old-pattern",
    title: "Migrations that finish",
    line: "Phase out an old library and block it from creeping back.",
    more:
      "The count of remaining uses can only fall. Once it reaches zero, a new use stops a change from passing.",
    href: "/docs/understand/standards",
  },
  {
    kind: "benefit",
    id: "keep-clutter-down",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "keep-clutter-down",
    title: "Clutter stays gone",
    line: "Clear out dead code and duplicates, and stop them piling back up.",
    more:
      "A cleanup playbook removes only what's proven safe to delete. A limit on what's left stops the count from rising again.",
    href: "/docs/guides/create-and-manage-skills",
  },
  {
    kind: "benefit",
    id: "catch-documentation-breakage",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "catch-documentation-breakage",
    title: "Dead links get caught",
    line: "A broken link in your project's guide fails like a broken test.",
    more:
      "The same goes for section anchors and discern command examples in the guide your agents maintain. Whether an explanation is still right stays a judgment for you and your agents.",
    href: "/docs/guides/maintain-project-map",
  },
  {
    kind: "benefit",
    id: "improve-practice-from-evidence",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "improve-practice-from-evidence",
    title: "See where time goes",
    line:
      "Find out where your agents keep getting stuck, counted from real runs.",
    more:
      "A local record of what discern's commands did shows repeated failures and slow steps. It holds no code and ranks no agent.",
    href: "/docs/guides/improve-the-practice",
  },
  {
    kind: "statement",
    id: "statement-a-project-that-only-gets-better",
    cluster: "make-improvement-accumulate",
    source: "consequence",
    cites: "a-project-that-only-gets-better",
    text: "A project that only gets better.",
    more:
      "A quality limit you set can tighten, and no change can loosen one without your approval. What the project learns is where the next session starts.",
    href: "/docs/understand/standards",
  },

  {
    kind: "benefit",
    id: "teach-project-once",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "teach-project-once",
    title: "Teach it once",
    line: "Explain a rule once, and every agent session starts out knowing it.",
    more:
      "Lessons go into one set of project instructions, written into the file each coding agent reads. You stop repeating the same correction in every prompt.",
    href: "/docs/guides/write-project-instructions",
  },
  {
    kind: "benefit",
    id: "inspect-agent-understanding",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "inspect-agent-understanding",
    title: "What your agents know",
    line: "Read a plain account of how your agents think your project works.",
    more:
      "Your agents keep a guide to the project, called the map, and update it as the code changes. Spot a misunderstanding there and correct it before it becomes a bug.",
    href: "/docs/understand/instructions-skills-and-map",
  },
  {
    kind: "benefit",
    id: "preserve-decision-reasons",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "preserve-decision-reasons",
    title: "Remember the why",
    line:
      "Keep the reasons behind big decisions where future agents will find them.",
    more:
      "A short record captures the context, the choice, and the options you turned down. Later sessions are less likely to reopen a settled question.",
    href: "/docs/understand/instructions-skills-and-map",
  },
  {
    kind: "benefit",
    id: "instructions-at-failure",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "instructions-at-failure",
    title: "Advice when it's needed",
    line: "A known problem shows up with the fix you already wrote down.",
    more:
      "Record a recurring trap once, with what to do about it. The next agent to hit it gets your note in the same result that reports the failure.",
    href: "/docs/guides/maintain-project-map",
  },
  {
    kind: "benefit",
    id: "orient-new-session",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "orient-new-session",
    title: "Quick to catch up",
    line:
      "A fresh agent finds the right docs and commands without reading everything.",
    more:
      "Documentation search returns the few pages a task needs. A mistyped or renamed command points to the right one.",
    href: "/docs/start/how-discern-works",
  },
  {
    kind: "benefit",
    id: "export-project-briefing",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "export-project-briefing",
    title: "Briefings on demand",
    line: "Export what a new teammate or agent should read as one file.",
    more:
      "Choose the public pages, a named reading list, or a hand-picked set. The reader gets them in a set order instead of a documentation dump.",
    href: "/docs/guides/maintain-project-map",
  },
  {
    kind: "benefit",
    id: "reuse-engineering-discipline",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "reuse-engineering-discipline",
    title: "One source of truth",
    line: "Have agents define each value once, so copies stop drifting apart.",
    more:
      "A built-in playbook carries the habits behind discern's own code into any project. Another habit it teaches: when a list grows, its tests and docs grow with it.",
    href: "/docs/guides/create-and-manage-skills",
  },
  {
    kind: "benefit",
    id: "agent-invoke-curated-project-procedures",
    cluster: "keep-project-knowledge-working",
    source: "agent-benefit",
    cites: "invoke-curated-project-procedures",
    title: "Playbooks for hard jobs",
    line:
      "Agents follow step-by-step playbooks for jobs like fixing bugs and splitting work.",
    more:
      "Skills, as discern calls them, come built in, and you can write your own for the jobs your project repeats.",
    href: "/docs/guides/create-and-manage-skills",
  },
  {
    kind: "statement",
    id: "statement-documentation-stops-being-owed",
    cluster: "keep-project-knowledge-working",
    source: "consequence",
    cites: "documentation-stops-being-owed",
    text: "Documentation stops being something you owe.",
    more:
      "The agents that change your code also keep its guide current. You read their account instead of writing it.",
    href: "/docs/guides/maintain-project-map",
  },
  {
    kind: "statement",
    id: "statement-taste-becomes-infrastructure",
    cluster: "keep-project-knowledge-working",
    source: "consequence",
    cites: "taste-becomes-infrastructure",
    text: "Your taste becomes every agent's standard.",
    more:
      "Your conventions go into every agent's instructions, the numbers you care about become limits, and agents answer your review questions on matching changes. The taste stays yours: discern adds none of its own.",
    href: "/docs/guides/write-project-instructions",
  },

  {
    kind: "benefit",
    id: "agent-commissioning",
    cluster: "put-practice-in-place",
    source: "human-benefit",
    cites: "agent-commissioning",
    title: "Agent-led setup",
    line: "Your coding agent installs and fine-tunes discern for your project.",
    more:
      "It studies your repository, connects the commands you already use, and asks you a short batch of questions. Setup counts as done only when your tests pass in a fresh copy of the project.",
    href: "/docs/start/installation-and-setup",
  },
  {
    kind: "benefit",
    id: "small-installation-footprint",
    cluster: "put-practice-in-place",
    source: "human-benefit",
    cites: "small-installation-footprint",
    title: "Nothing to host",
    line: "Add discern with no account, server, or service to set up.",
    more:
      "It's a program on your own machine, and its settings for your project live in one file you can read and edit.",
    href: "/docs/understand/local-control",
  },
  {
    kind: "benefit",
    id: "inspect-live-example",
    cluster: "put-practice-in-place",
    source: "human-benefit",
    cites: "inspect-live-example",
    title: "Built with itself",
    line: "Every change to discern is made with discern itself.",
    more:
      "Its own development uses separate tasks, quality limits, and a record for every merged change. That's the same setup it brings to your project.",
  },
  {
    kind: "benefit",
    id: "clean-abandoned-environments",
    cluster: "put-practice-in-place",
    source: "human-benefit",
    cites: "clean-abandoned-environments",
    title: "Tidy up safely",
    line: "Remove abandoned tasks, and bring one back if you chose wrong.",
    more:
      "Removing a task frees its folder, ports, and databases. Each recently removed task keeps its last commit, so committed work can come back.",
    href: "/docs/guides/recover-an-interrupted-task",
  },
  {
    kind: "benefit",
    id: "agent-manage-the-installation-lifecycle",
    cluster: "put-practice-in-place",
    source: "agent-benefit",
    cites: "manage-the-installation-lifecycle",
    title: "A built-in health check",
    line:
      "If something breaks, one command finds the problem and names the fix.",
    more:
      "When something stops working, ask your agent to check the installation. It runs the check, applies the fixes, and tells you what it needs from you.",
    href: "/docs/guides/maintain-or-remove-discern",
  },
  {
    kind: "statement",
    id: "statement-try-it-where-it-matters",
    cluster: "put-practice-in-place",
    source: "consequence",
    cites: "try-it-where-it-matters",
    text: "Try it on the project that matters.",
    more:
      "Setup is work your agent does. Leaving takes one command and keeps every file you wrote.",
    href: "/docs/start/installation-and-setup",
  },
  {
    kind: "statement",
    id: "statement-get-serious-when-it-gets-real",
    cluster: "put-practice-in-place",
    source: "consequence",
    cites: "get-serious-when-it-gets-real",
    text: "Get serious the week it gets real.",
    more:
      "A first paying user or a first collaborator can arrive without warning. Setup is same-day work for your agent.",
    href: "/docs/start",
  },
  {
    kind: "numeral",
    id: "numeral-one-config-file",
    cluster: "put-practice-in-place",
    source: "claim",
    cites: "one-config-file",
    numeral: "1",
    title: "One config file",
    line: "Every discern setting for your project lives in one file.",
    more:
      "Your instructions, project guide, and agent files sit beside it as ordinary files you own.",
    href: "/docs/reference/config-reference",
  },
  {
    kind: "numeral",
    id: "numeral-limits-on-itself",
    cluster: "put-practice-in-place",
    source: "claim",
    cites: "runs-on-itself",
    numeral: String(OWN_QUALITY_LIMITS),
    title: "Limits on itself",
    line:
      "That's how many quality limits discern's own code and writing must meet.",
    more:
      "They run from test coverage to the reading level of its docs. You can set the same kind of limit on your own project.",
  },

  {
    kind: "benefit",
    id: "switch-providers",
    cluster: "change-tools-without-starting-over",
    source: "human-benefit",
    cites: "switch-providers",
    title: "Switch agents freely",
    line:
      "Change coding agents without explaining your project all over again.",
    more:
      "Your instructions, quality limits, and project guide belong to the project. Connect another supported agent and discern writes the files it reads from the same sources.",
    href: "/docs/guides/connect-a-coding-agent",
  },
  {
    kind: "benefit",
    id: "practice-across-stacks",
    cluster: "change-tools-without-starting-over",
    source: "human-benefit",
    cites: "practice-across-stacks",
    title: "Any language, any stack",
    line: "Work the same way in every project, whatever it's written in.",
    more:
      "Your project's own commands do the checking, so there's no plugin to wait for and nothing tied to one language or framework.",
    href: "/docs/start/how-discern-works",
  },
  {
    kind: "benefit",
    id: "build-on-published-contracts",
    cluster: "change-tools-without-starting-over",
    source: "human-benefit",
    cites: "build-on-published-contracts",
    title: "Scriptable by design",
    line: "Get any result as JSON with a published schema for your scripts.",
    more:
      "The terminal, your agent, and your own tools all read the same result. Nothing has to scrape text meant for people.",
    href: "/docs/reference/mcp-and-results",
  },
  {
    kind: "benefit",
    id: "planned-upgrades",
    cluster: "change-tools-without-starting-over",
    source: "human-benefit",
    cites: "planned-upgrades",
    title: "Upgrade on your schedule",
    line: "See what an upgrade will change, then update when it suits you.",
    more:
      "The program never updates itself. Release notes show what's new, and teammates on an older version hear when to catch up.",
    href: "/docs/guides/maintain-or-remove-discern",
  },
  {
    kind: "benefit",
    id: "retain-work-after-uninstall",
    cluster: "change-tools-without-starting-over",
    source: "human-benefit",
    cites: "retain-work-after-uninstall",
    title: "Leave without losing work",
    line:
      "Uninstall with one command and keep everything you and your agents wrote.",
    more:
      "Your instructions, project guide, playbooks, and settings stay as ordinary files in your repository. Only discern's wiring goes.",
    href: "/docs/guides/maintain-or-remove-discern",
  },
  {
    kind: "benefit",
    id: "agent-switch-supported-agent-hosts",
    cluster: "change-tools-without-starting-over",
    source: "agent-benefit",
    cites: "switch-supported-agent-hosts",
    title: "One task, two agents",
    line: "Start a task with one coding agent and finish it with another.",
    more:
      "A task's branch, setup, and results live in the project instead of in one tool's chat history. Any supported agent you've connected can ask where things stand and carry on.",
    href: "/docs/guides/connect-a-coding-agent",
  },
  {
    kind: "statement",
    id: "statement-the-same-interview-for-every-agent",
    cluster: "change-tools-without-starting-over",
    source: "consequence",
    cites: "the-same-interview-for-every-agent",
    text: "Every new agent walks into the same interview.",
    more:
      "A new coding agent reads the same instructions, faces the same tests, and returns the same kind of record as the last one.",
    href: "/docs/guides/connect-a-coding-agent",
  },
  {
    kind: "statement",
    id: "statement-what-agents-learn-you-own",
    cluster: "change-tools-without-starting-over",
    source: "consequence",
    cites: "what-agents-learn-you-own",
    text: "Everything your agents learn becomes something you own.",
    more:
      "Instructions, playbooks, the project guide, and decision records are ordinary files in your repository. Back them up, hand them over, or take them elsewhere.",
    href: "/docs/reference/files-and-ownership",
  },
  {
    kind: "numeral",
    id: "numeral-supported-coding-agents",
    cluster: "change-tools-without-starting-over",
    source: "claim",
    cites: "one-instruction-source",
    numeral: String(SUPPORTED_AGENTS.length),
    title: "Coding agents supported",
    line: `${listed(SUPPORTED_AGENTS)} all read the same instructions.`,
    more:
      "Pick your favorite, or use several at once. Each reads the same project instructions in the file it expects.",
    href: "/docs/reference/platforms-and-providers",
  },

  {
    kind: "benefit",
    id: "local-without-another-model",
    cluster: "keep-control",
    source: "human-benefit",
    cites: "local-without-another-model",
    title: "No API key",
    line: "No AI model inside means no API key and no model bill.",
    more:
      "It runs your project's own commands and records the results. Your coding agent still uses its own model provider.",
    href: "/docs/understand/local-control",
  },
  {
    kind: "benefit",
    id: "explicit-write-authority",
    cluster: "keep-control",
    source: "human-benefit",
    cites: "explicit-write-authority",
    title: "Stays in its lane",
    line:
      "Every file discern writes goes to a default spot or a path you chose.",
    more:
      "Before you approve setup, you see what will be added. A command that writes to Git checks first that it can, so it stops before it starts instead of failing halfway.",
    href: "/docs/understand/local-control",
  },
  {
    kind: "benefit",
    id: "agent-diagnose-workflow-friction-locally",
    cluster: "keep-control",
    source: "agent-benefit",
    cites: "diagnose-workflow-friction-locally",
    title: "No telemetry",
    line:
      "What discern records stays on your machine, and it sends no telemetry.",
    more:
      "Its activity log holds names, timings, and results, with no code or command output, and you can switch it off. Your coding agent and your project's commands can still use the network.",
    href: "/docs/reference/logbook",
  },
  {
    kind: "statement",
    id: "statement-decisions-wait-for-the-person",
    cluster: "keep-control",
    source: "consequence",
    cites: "decisions-wait-for-the-person",
    text: "Work keeps moving until it needs your yes.",
    more:
      "Agents keep working, and wait on each other where they need to. A change that needs your approval waits, tested and ready, until you give it.",
    href: "/docs/guides/finish-and-land-a-change",
  },
] satisfies readonly WallCard[];

/**
 * The `index`th point of the golden-ratio sequence, from 0 up to 1. Successive
 * points fall far apart and never settle into a repeating pattern. Each depends
 * on nothing but its index, so an order built from them is the same in every
 * build and every browser.
 */
function goldenPoint(index: number): number {
  return (index * 0.6180339887) % 1;
}

/**
 * `items` in a scattered order: neighbors in the input land far apart, and any
 * run of them is spread through the whole result.
 */
function scattered<T>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, place: goldenPoint(index) }))
    .sort((a, b) => a.place - b.place)
    .map(({ item }) => item);
}

/**
 * `major` with the `minor` items set into it, both in order. The minor items
 * fall about evenly through the result. Each is nudged off the exact interval,
 * so that they do not line up in rows when the list wraps into columns.
 */
function woven<T>(major: readonly T[], minor: readonly T[]): T[] {
  const result = [...major];
  const interval = (major.length + minor.length) / minor.length;
  minor.forEach((item, index) => {
    const offset = 0.25 + goldenPoint(index) / 2;
    result.splice(Math.floor((index + offset) * interval), 0, item);
  });
  return result;
}

/**
 * The cards in display order. Benefit cards are scattered so that no cluster
 * gathers in one part of the wall. Statement cards are scattered the same way
 * with the numeral cards spaced through them, and that sequence is then spaced
 * through the benefit cards.
 */
function displayOrder(cards: readonly WallCard[]): WallCard[] {
  const ofKind = (kind: WallCard["kind"]): WallCard[] =>
    scattered(cards.filter((card) => card.kind === kind));
  return woven(
    ofKind("benefit"),
    woven(ofKind("statement"), ofKind("numeral")),
  );
}

/** Every card on the wall, in the order the wall shows them. */
export const WALL_DECK: readonly WallCard[] = displayOrder(CARDS);

/** The lenses a visitor can view the wall through, in chip order. */
export const WALL_LENSES: readonly WallLens[] = [
  {
    id: "move-more-work",
    label: "Move more work",
    clusters: ["build-further"],
  },
  {
    id: "get-your-time-back",
    label: "Get your time back",
    clusters: ["return-human-attention"],
  },
  {
    id: "trust-what-ships",
    label: "Trust what ships",
    clusters: ["know-what-is-ready", "keep-control"],
  },
  {
    id: "keep-getting-better",
    label: "Keep getting better",
    clusters: ["make-improvement-accumulate"],
  },
  {
    id: "stop-repeating-yourself",
    label: "Stop repeating yourself",
    clusters: ["keep-project-knowledge-working"],
  },
  {
    id: "adopt-on-your-terms",
    label: "Adopt on your terms",
    clusters: ["put-practice-in-place", "change-tools-without-starting-over"],
  },
];

/**
 * Human benefits left off the wall, each with the reason. A benefit that cannot
 * be made tangible for a newcomer belongs here rather than on a vague card.
 */
export const WALL_ABSENT: Readonly<Record<string, string>> = {};
