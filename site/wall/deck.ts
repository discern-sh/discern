/**
 * The wall's cards.
 *
 * Cards are authored by cluster, in the benefit canon's order, so the copy for
 * one family of outcomes reads together. `WALL_DECK` is the same set in display
 * order: an authored lead, then the clusters scattered through one another,
 * with the statement and numeral cards spaced through the benefit cards. Every
 * card cites the registry entry it expresses.
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
 * The supported agents whose name alone could mean a chat app or an editor
 * plug-in. For each of these, discern supports the command-line tool.
 */
const COMMAND_LINE_AGENTS: readonly string[] = [
  agentLabelForNative("gemini"),
  agentLabelForNative("copilot"),
];

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
      "A follow-up can begin from an earlier task's tested commit while that one waits for your approval. Each task still merges only when you approve it.",
    href:
      "/docs/guides/coordinate-parallel-tasks#build-on-work-before-it-lands",
  },
  {
    kind: "benefit",
    id: "land-finished-work-as-the-project-moves",
    cluster: "build-further",
    source: "human-benefit",
    cites: "land-finished-work-as-the-project-moves",
    title: "Merge in any order",
    line:
      "Finished work still merges after other changes land, retested on the combined code.",
    more:
      "A temporary copy combines both changes, your tests run on the result, and only what passed merges. A real conflict goes back to the agent that wrote the change.",
    href: "/docs/guides/finish-and-land-a-change#when-other-work-lands-first",
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
    title: "Don't run tests twice",
    line: "If your agent loses a long test run, it reads the result back.",
    more:
      "A long run saves its progress and its final result as it goes. An agent that loses the connection reads them back instead of starting the run again.",
    href: "/docs/guides/recover-an-interrupted-task",
  },
  {
    kind: "statement",
    id: "statement-parallel-by-default",
    cluster: "build-further",
    source: "consequence",
    cites: "parallel-by-default",
    text: "Run three tasks as easily as one.",
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
    title: "Standing review questions",
    line:
      "Write a review question once, and agents answer it on every matching change.",
    more:
      "You choose the files that trigger each question, such as whether a database change can be undone. This is what discern calls a checkpoint, and an unmet answer waits for you.",
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
    title: "No wasted checks",
    line:
      "Checks for one part of your project run only when that part changes.",
    more:
      "You name an area, such as your docs, and the check it needs, such as a link checker. Your tests and other everyday commands still run on every change.",
    href: "/docs/guides/finish-and-land-a-change",
  },
  {
    kind: "benefit",
    id: "context-for-the-task",
    cluster: "return-human-attention",
    source: "human-benefit",
    cites: "context-for-the-task",
    title: "Less noise for agents",
    line: "Results stay short, so your agent's attention goes to your code.",
    more:
      "Each result is short and names the next step. Long output keeps its start and end, and the full text goes to a file.",
    href: "/docs/start/how-discern-works",
  },
  {
    kind: "statement",
    id: "statement-the-job-moves-up-a-level",
    cluster: "return-human-attention",
    source: "consequence",
    cites: "the-job-moves-up-a-level",
    text: "Less checking, more deciding.",
    more:
      "Agents carry the coordination, the testing, and the record of what passed. Your time goes to briefs, design, and deciding what merges.",
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
      "Every finished change shows which of your commands passed, and on which commit.",
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
      "When a change merges, discern attaches its record to that commit as a Git note. The note outlives the task's folder and the agent's session, and you choose whether to share it.",
    href: "/docs/understand/proof",
  },
  {
    kind: "benefit",
    id: "explicit-release-decision",
    cluster: "know-what-is-ready",
    source: "human-benefit",
    cites: "explicit-release-decision",
    title: "Experiment freely",
    line: "Rapidly iterate on new features and experiments with confidence.",
    more:
      "Each experiment runs on its own branch and merges only with your approval. Keep what passes your tests and throw the rest away.",
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
      "Name the areas you approve in advance, such as documentation. A change that touches any file outside them still comes to you.",
    href: "/docs/guides/finish-and-land-a-change#pre-approve-routine-work",
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
      "Each task lives on its own branch in its own folder. Your main branch changes only when you approve a finished result.",
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
    title: "Tested or only claimed",
    line:
      "Every result separates what passed your tests from what your agent only judged.",
    more:
      "Commands that ran show as passed or failed. An agent's answer to a review question shows apart from them, as that agent's judgment.",
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
      "Your tests and other commands run on your machine before you share anything. CI, the checks that run after you push, then confirms a result you've already seen.",
    href: "/docs/guides/run-the-gate-in-ci",
  },

  {
    kind: "benefit",
    id: "retain-measured-gains",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "retain-measured-gains",
    title: "Gains that stick",
    line:
      "Set a limit, like minimum test coverage, that agents can't lower to pass.",
    more:
      "Every change has to meet the limit on your main branch, and loosening one takes your approval. These limits are what discern calls standards.",
    href: "/docs/understand/standards",
  },
  {
    kind: "benefit",
    id: "pin-new-baseline",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "pin-new-baseline",
    title: "Raise the bar",
    line:
      "When test coverage improves, one command locks the gain in as the new minimum.",
    more:
      "The command tightens the limit to the new value and saves that change as its own commit. A margin you set keeps ordinary ups and downs from failing the next change.",
    href: "/docs/understand/standards#lock-in-a-gain",
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
    title: "Fix it everywhere",
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
    line:
      "A broken link in the docs your agents keep fails like a broken test.",
    more:
      "The same check covers section anchors and discern command examples in the project guide. Whether an explanation is still right stays a judgment for you and your agents.",
    href: "/docs/guides/maintain-project-map",
  },
  {
    kind: "benefit",
    id: "improve-practice-from-evidence",
    cluster: "make-improvement-accumulate",
    source: "human-benefit",
    cites: "improve-practice-from-evidence",
    title: "See where agents struggle",
    line:
      "Find out where your agents keep getting stuck, counted from real runs.",
    more:
      "A local activity log of what discern's commands did shows repeated failures and slow steps. It holds no code and ranks no agent.",
    href: "/docs/guides/improve-the-practice",
  },
  {
    kind: "statement",
    id: "statement-a-project-that-only-gets-better",
    cluster: "make-improvement-accumulate",
    source: "consequence",
    cites: "a-project-that-only-gets-better",
    text: "Your quality bar never drops without your say-so.",
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
      "Your agents keep a project guide, which discern calls the map, and update it as the code changes. Spot a misunderstanding there and correct it before it becomes a bug.",
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
      "A short decision record captures the context, the choice, and the options you turned down. Later sessions are less likely to reopen a settled question.",
    href: "/docs/understand/instructions-skills-and-map",
  },
  {
    kind: "benefit",
    id: "instructions-at-failure",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "instructions-at-failure",
    title: "Known fixes, delivered",
    line:
      "When an agent hits a problem you've seen before, it gets your written fix.",
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
    title: "New sessions start fast",
    line:
      "A new session searches the docs your agents keep and reads only what its task needs.",
    more:
      "Search ranks the project guide's pages for the task and returns the best few. A mistyped or renamed command points to the right one.",
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
      "Choose the project guide's public pages, a named reading list, or a hand-picked set. The reader gets them in a set order instead of a documentation dump.",
    href: "/docs/guides/maintain-project-map",
  },
  {
    kind: "benefit",
    id: "reuse-engineering-discipline",
    cluster: "keep-project-knowledge-working",
    source: "human-benefit",
    cites: "reuse-engineering-discipline",
    title: "One source of truth",
    line:
      "A built-in playbook has agents define each value once and test every use.",
    more:
      "Each fact gets one home, and a test keeps every copy in step with it. When a list grows, its tests and docs grow with it.",
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
    text: "Your agents write the docs, and you read them.",
    more:
      "The agents that change your code also keep the project guide current. You read their account instead of writing it.",
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
      "It studies your repository, connects the commands you already use, and asks you a short batch of questions. Setup usually takes 20 to 40 minutes and counts as done only when your tests pass in a fresh copy of the project.",
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
      "It's one program that runs on your own machine. Your project needs Git and nothing else new.",
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
      "Its own development uses separate tasks, quality limits, and a record of what passed for every merged change. That's the same setup it brings to your project.",
  },
  {
    kind: "benefit",
    id: "clean-abandoned-environments",
    cluster: "put-practice-in-place",
    source: "human-benefit",
    cites: "clean-abandoned-environments",
    title: "Tidy up safely",
    line:
      "Delete old tasks, and recover their committed work if you change your mind.",
    more:
      "Removing a task frees its folder, ports, and databases. Each recently removed task keeps its last commit, so committed work can come back.",
    href: "/docs/guides/recover-an-interrupted-task#recover-a-dropped-branch",
  },
  {
    kind: "benefit",
    id: "agent-manage-the-installation-lifecycle",
    cluster: "put-practice-in-place",
    source: "agent-benefit",
    cites: "manage-the-installation-lifecycle",
    title: "A built-in health check",
    line:
      "If discern stops working, one command finds the problem and names the fix.",
    more:
      "Ask your agent to check the installation. It runs the check, applies the fixes it can, and tells you what it needs from you.",
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
      "Setup usually takes your agent 20 to 40 minutes. Leaving takes one command and keeps every file you wrote.",
    href: "/docs/start/installation-and-setup",
  },
  {
    kind: "statement",
    id: "statement-get-serious-when-it-gets-real",
    cluster: "put-practice-in-place",
    source: "consequence",
    cites: "get-serious-when-it-gets-real",
    text: "Add it the week your project gets real users.",
    more:
      "A first paying user or a first collaborator can arrive without warning. Setup usually takes your agent 20 to 40 minutes.",
    href: "/docs/start",
  },
  {
    kind: "numeral",
    id: "numeral-one-config-file",
    cluster: "put-practice-in-place",
    source: "claim",
    cites: "one-config-file",
    numeral: "1",
    title: "Config file",
    line:
      "Every discern setting for your project lives in a single readable file.",
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
    title: "Limits it must meet",
    line:
      "Every change to discern has to pass them, from test coverage to reading level.",
    more:
      "Others cap its download size, its duplicated code, and its lint exceptions. You can set the same kind of limit on your own project.",
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
      "Your project's own commands do the checking, so any language or framework works. It needs Git, and it runs on macOS, Linux, and Windows through WSL 2.",
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
    text: "Every agent faces the same rules and tests.",
    more:
      "A new coding agent reads the same instructions and has to pass the same commands as the last one. Its work comes back with the same kind of record of what passed.",
    href: "/docs/guides/connect-a-coding-agent",
  },
  {
    kind: "statement",
    id: "statement-what-agents-learn-you-own",
    cluster: "change-tools-without-starting-over",
    source: "consequence",
    cites: "what-agents-learn-you-own",
    text: "What you teach your agents stays in your repository.",
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
    more: `${
      listed(COMMAND_LINE_AGENTS)
    } here mean their command-line tools. Use one agent or several, and each reads the same project instructions in the file it expects.`,
    href: "/docs/reference/platforms-and-providers",
  },

  {
    kind: "benefit",
    id: "local-without-another-model",
    cluster: "keep-control",
    source: "human-benefit",
    cites: "local-without-another-model",
    title: "No API key",
    line: "No AI model inside, so there's no API key and no extra model bill.",
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
    line: "Every place discern can write is on a list you can read.",
    more:
      "Before you approve setup, you see what it will add. A command that writes to Git checks first that it can, so it stops before it starts instead of failing halfway.",
    href: "/docs/reference/files-and-ownership",
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
      "Its activity log holds names, timings, and results, with no code or command output, and you can switch it off. Checking for updates opens the release page in your browser with your version number, and nothing else leaves your machine through discern.",
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
 * The cards the wall opens on, by id, in order. They are the first words a
 * visitor reads. A lens lists the cards it keeps in display order, so the lead
 * also opens each lens, and it holds a card from every lens.
 */
export const WALL_LEAD: readonly string[] = [
  "agent-commissioning",
  "parallel-work-on-one-machine",
  "project-defined-completion",
  "statement-cheap-failure-buys-bold-work",
  "teach-project-once",
  "explicit-release-decision",
  "switch-providers",
  "local-without-another-model",
  "reduce-routine-review",
  "retain-measured-gains",
];

/**
 * The cards in display order: the lead, then every other card. Among the
 * others, benefit cards are scattered so that no cluster gathers in one part
 * of the wall. Statement cards are scattered the same way with the numeral
 * cards spaced through them, and that sequence is then spaced through the
 * benefit cards.
 */
function displayOrder(cards: readonly WallCard[]): WallCard[] {
  const lead = WALL_LEAD.flatMap((id) =>
    cards.filter((card) => card.id === id)
  );
  const ofKind = (kind: WallCard["kind"]): WallCard[] =>
    scattered(
      cards.filter((card) => card.kind === kind && !lead.includes(card)),
    );
  return [
    ...lead,
    ...woven(
      ofKind("benefit"),
      woven(ofKind("statement"), ofKind("numeral")),
    ),
  ];
}

/** Every card on the wall, in the order the wall shows them. */
export const WALL_DECK: readonly WallCard[] = displayOrder(CARDS);

/** The lenses a visitor can view the wall through, in chip order. */
export const WALL_LENSES: readonly WallLens[] = [
  {
    id: "run-more-at-once",
    label: "Run more at once",
    clusters: ["build-further"],
  },
  {
    id: "review-less",
    label: "Review less",
    clusters: ["return-human-attention"],
  },
  {
    id: "know-its-ready",
    label: "Know it's ready",
    clusters: ["know-what-is-ready"],
  },
  {
    id: "keep-quality-up",
    label: "Keep quality up",
    clusters: ["make-improvement-accumulate"],
  },
  {
    id: "stop-repeating-yourself",
    label: "Stop repeating yourself",
    clusters: ["keep-project-knowledge-working"],
  },
  {
    id: "safe-to-try",
    label: "Safe to try",
    clusters: ["put-practice-in-place", "keep-control"],
  },
  {
    id: "fits-your-tools",
    label: "Fits your tools",
    clusters: ["change-tools-without-starting-over"],
  },
];

/**
 * Human benefits left off the wall, each with the reason. A benefit that cannot
 * be made tangible for a newcomer belongs here rather than on a vague card.
 */
export const WALL_ABSENT: Readonly<Record<string, string>> = {};
