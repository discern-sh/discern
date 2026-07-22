/**
 * The authored homepage. site/build.ts renders this composition with the
 * design system's React adapters, wraps it in the shared document shell, and
 * writes static HTML: the browser receives no React runtime.
 */

import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  Callout,
  CodeListing,
  CtaBand,
  FaqBlock,
  FeatureBento,
  HeadingAccent,
  HeroBlock,
  KeyPoints,
  MetricsBand,
  ProcessSteps,
  SiteFooter,
  SiteHeader,
  SkipLink,
  SplitFeature,
  Terminal,
  Transcript,
  Window,
  Worklog,
} from "discern-design-system/react";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";
const INSTALL_COMMAND = "curl -fsSL https://discern.sh/install | sh";
const SETUP_SENTENCE = "Set this project up with discern.";

/** The one-line install command with a progressive-enhancement copy slot. */
function InstallCommand() {
  return (
    <p className="landing-install" data-copy-command={INSTALL_COMMAND}>
      <code className="landing-install__command">{INSTALL_COMMAND}</code>
    </p>
  );
}

/** Static theme toggle wired at runtime by the shared /assets/theme.js. */
function LandingThemeToggle() {
  return (
    <button
      type="button"
      className="discern-theme-toggle landing-theme"
      aria-label="Switch to the dark theme"
      aria-pressed="false"
      data-theme-toggle
    >
      <span className="discern-theme-toggle__glyph" aria-hidden="true">
        <span data-theme-toggle-glyph="light">☀</span>
        <span data-theme-toggle-glyph="dark">☾</span>
      </span>
    </button>
  );
}

/** The conversation the hero illustrates: intent in, checked work out. */
function HeroSession() {
  return (
    <Window title="your-project · agent session" className="landing-session">
      <Transcript
        className="landing-session__chat"
        turns={[
          { speaker: "You", body: "Add sign-in with Google." },
          {
            speaker: "Your agent",
            body: (
              <Worklog
                entries={[
                  {
                    label: "Opened a separate workspace",
                    status: "done",
                    detail: "agent/google-sign-in",
                  },
                  { label: "Built the sign-in flow", status: "done" },
                  {
                    label: "Ran your project's checks",
                    status: "failed",
                    detail: "1 test failed: session expiry",
                  },
                  {
                    label: "Fixed it and re-ran every check",
                    status: "done",
                    detail: "format, lint, types, tests: passing",
                  },
                ]}
              />
            ),
          },
          {
            speaker: "Your agent",
            body:
              "Sign-in works, and the version waiting for you is the version that passed. Say the word and I'll land it.",
          },
        ]}
      />
    </Window>
  );
}

function LandingPage() {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <SiteHeader
        brand="discern"
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        navItems={[
          { label: "How it works", href: "#how-it-works" },
          { label: "FAQ", href: "#faq" },
          { label: "Docs", href: "/docs" },
          { label: "GitHub ↗", href: GITHUB },
        ]}
        actions={
          <>
            <LandingThemeToggle />
            <Button href="#get-started" size="sm">Install</Button>
          </>
        }
      />
      <main id="main">
        <HeroBlock
          eyebrow="For people who build software with coding agents"
          title={
            <>
              Add the next feature{" "}
              <HeadingAccent>without breaking the last one</HeadingAccent>
            </>
          }
          description="You describe what you want. Your agent builds it. discern gives that agent a dependable way of working: a separate copy of your project for every change, your project's own checks before anything counts as done, and nothing landing until you say so."
          actions={
            <>
              <Button href="#get-started" size="lg">Get started</Button>
              <Button href="#how-it-works" size="lg" variant="secondary">
                How it works
              </Button>
            </>
          }
          meta={
            <>
              <InstallCommand />
              <p className="landing-install__note">
                Works with Claude Code, Codex, Gemini, Cursor, and GitHub
                Copilot.
              </p>
            </>
          }
          visual={<HeroSession />}
        />

        <div className="landing-band landing-band--sunken">
          <div className="landing-wrap">
            <KeyPoints
              eyebrow="The pattern"
              title="The trouble starts a few prompts later"
              items={[
                {
                  title: "A fix here breaks something there",
                  description:
                    "New work lands on top of old work, and nothing re-checks the parts nobody was looking at.",
                },
                {
                  title: "The agent forgets your rules",
                  description:
                    "A convention you set three chats ago is gone today, so you repeat yourself and hope it sticks.",
                },
                {
                  title: "Done gets announced early",
                  description:
                    "The summary sounds finished. The app disagrees.",
                },
              ]}
            />
            <p className="landing-band__close">
              So more of your time goes to supervising and repairing, and less
              to the thing you set out to build. None of this means you built it
              wrong. It means the project now needs the habits that keep
              software changeable, and those shouldn't have to become your job.
              discern hands them to the one doing the work: your agent.
            </p>
          </div>
        </div>

        <ProcessSteps
          id="how-it-works"
          eyebrow="How it works"
          title="What happens after you ask"
          description="You keep talking to your agent the way you do today. With discern in the project, every change moves through the same loop, built from your project's own commands."
          orientation="vertical"
          steps={[
            {
              eyebrow: "You",
              title: "Describe the change",
              description:
                "“Add subscriptions.” “Fix the upload bug.” “Make it work offline.” Plain language, same as today.",
            },
            {
              eyebrow: "Your agent",
              title: "Works in a separate copy",
              description:
                "Each task gets its own workspace and branch, away from the version you rely on. Half-finished work never touches the app you can open.",
              detail: (
                <>
                  Underneath: <code>discern start</code>{" "}
                  creates an isolated Git worktree with its own branch, a
                  deterministic port, and any resources your project declares.
                </>
              ),
            },
            {
              eyebrow: "Your agent",
              title: "Checks the work before reporting it",
              description:
                "The project's checks run before the agent calls anything finished. A failure comes back as the failing command and its output, so the agent fixes the problem and runs the loop again.",
              detail: (
                <>
                  Underneath: <code>discern done</code>{" "}
                  runs the format, lint, type-check, test, and build commands
                  declared in <code>discern.toml</code>.
                </>
              ),
            },
            {
              eyebrow: "You",
              title: "Review it, then land it",
              description:
                "On a clean pass, the agent reports what ran and waits. Nothing reaches your main branch until you approve it.",
              detail: (
                <>
                  Underneath: a green run on a committed tree records a receipt
                  for that commit; <code>discern accept</code>{" "}
                  lands the branch after your go-ahead and removes the
                  workspace.
                </>
              ),
            },
          ]}
        />
        <div className="landing-wrap landing-wrap--note">
          <Callout tone="note" title="Changes can take a little longer">
            Checking, fixing, and re-checking takes time, so a change can arrive
            slower than raw generation. In exchange, problems get caught while
            the agent still has the context to fix them, instead of days later
            by you.
          </Callout>
        </div>

        <SplitFeature
          id="get-started"
          eyebrow="Getting started"
          title="Install it once, then delegate"
          description="You run one command, then hand your agent one sentence. discern is built for agents to operate, and that starts with setup."
          points={[
            {
              title: "It asks before it writes",
              description:
                "Setup names the files it will create and waits for your yes. Everything lands on a branch you can read before it merges.",
            },
            {
              title: "It wires your stack, whatever it is",
              description:
                "The checks come from commands your project already runs; discern doesn't invent a test suite for you.",
            },
            {
              title: "Removal is one command",
              description: (
                <>
                  <code>discern uninstall</code>{" "}
                  removes the wiring and keeps your content.
                </>
              ),
            },
          ]}
          actions={
            <Button
              href="/docs/getting-started/quickstart"
              variant="secondary"
            >
              Read the quickstart
            </Button>
          }
          media={
            <Terminal title="terminal" className="landing-setup-terminal">
              {`$ ${INSTALL_COMMAND}
$ cd your-project

# then, in your coding agent:
> ${SETUP_SENTENCE}`}
            </Terminal>
          }
        />

        <FeatureBento
          eyebrow="The payoff"
          title="What changes as the project grows"
          items={[
            {
              eyebrow: "Fewer regressions",
              title: "Mistakes surface while they're cheap",
              description:
                "The checks run inside the agent's loop, so broken work gets fixed before it reaches the version you rely on.",
              size: "wide",
              tone: "accent",
            },
            {
              eyebrow: "Less repeating yourself",
              title: "Your rules stick",
              description:
                "Project conventions are written once in the repo and compiled into the instructions every configured agent reads, this session and every one after.",
            },
            {
              eyebrow: "More at once",
              title: "Parallel work stays apart",
              description:
                "Run several efforts at once, each in its own workspace, without them stepping on each other.",
            },
            {
              eyebrow: "Months later",
              title: "The project stays changeable",
              description:
                "The aim over time: asking for the tenth feature feels like asking for the first.",
              size: "wide",
            },
          ]}
        />

        <SplitFeature
          eyebrow="Under the hood"
          title="Inspectable machinery"
          description="The simplicity rests on ordinary, verifiable parts. Everything the checks will run sits in one committed file anyone can read."
          reverse
          surface="sunken"
          points={[
            {
              title: "Real Git worktrees",
              description:
                "One per change, on its own branch, with a deterministic port and per-worktree resources when you declare them.",
            },
            {
              title: "Your commands, run together",
              description:
                "Format, build, lint, type-check, test, smoke, and custom jobs, with failures returned as the failing command plus its captured output.",
            },
            {
              title: "Results bound to commits",
              description: (
                <>
                  A green <code>discern done</code>{" "}
                  on a clean tree records a receipt for that commit. Any further
                  edit lapses it.
                </>
              ),
            },
            {
              title: "One guidance source, every agent",
              description:
                "Write project instructions once; discern compiles the file each configured agent reads and materializes skills alongside.",
            },
            {
              title: "Standards that only tighten",
              description:
                "Hold a quality metric at a limit that can tighten or hold against your main branch, and can't loosen.",
            },
            {
              title: "MCP built in",
              description: (
                <>
                  Agents drive discern through structured MCP tools with typed
                  results; the CLI carries <code>--json</code>{" "}
                  for everything else.
                </>
              ),
            },
          ]}
          actions={
            <Button href="/docs/orientation/concepts" variant="secondary">
              Concepts: how it fits together
            </Button>
          }
          media={
            <CodeListing
              filename="discern.toml"
              language="toml"
              code={`[jobs]
format    = "prettier --write ."
lint      = "eslint ."
typecheck = "tsc --noEmit"
test      = "vitest run"

[repository]
trunk         = "main"
branch_prefix = "agent/"`}
              caption="Your project's checks, declared where everyone can read them."
            />
          }
        />

        <MetricsBand
          eyebrow="Trust & your data"
          title="It all happens on your machine"
          tone="contrast"
          items={[
            {
              value: "0",
              label: "network calls",
              detail: "after install, none; discern works fully offline",
            },
            {
              value: "0",
              label: "telemetry",
              detail: "nothing about your code or usage is collected",
            },
            {
              value: "1",
              label: "self-contained binary",
              detail: "no Node, no Deno; Git is the only other requirement",
            },
            {
              value: "5",
              label: "coding agents",
              detail: "Claude Code, Codex, Gemini, Cursor, and GitHub Copilot",
            },
          ]}
        />
        <div className="landing-wrap">
          <p className="landing-trust-note">
            The complete inventory of what discern writes, and what uninstall
            removes, is in{" "}
            <a href="/docs/orientation/trust-and-data">
              Trust &amp; your data
            </a>.
          </p>
        </div>

        <FaqBlock
          id="faq"
          eyebrow="Before you install"
          title="Fair questions"
          openFirst
          items={[
            {
              question: "Do I need to know Git or CI to use this?",
              answer:
                "No. Your agent operates discern; you describe changes, review results, and approve landings. The vocabulary is all in the docs whenever you want to go deeper.",
            },
            {
              question: "Will it slow my agent down?",
              answer:
                "Somewhat, on each change: checking, fixing, and re-checking takes time. Problems get handled inside the loop while the agent has context, instead of surfacing later as mysteries in the app.",
            },
            {
              question: "What does it write into my project?",
              answer: (
                <>
                  One committed <code>discern.toml</code>, a visible{" "}
                  <code>discern/</code>{" "}
                  folder you own, a marked block in agent config files and{" "}
                  <code>.gitignore</code>, and the generated agent files. A test
                  in discern's own build fails the moment any command writes
                  outside that footprint, and <code>discern uninstall</code>
                  {" "}
                  removes the wiring while keeping your content.
                </>
              ),
            },
            {
              question: "Does any of my code leave my machine?",
              answer:
                "No. discern makes zero network calls after install and ships no telemetry. It keeps one local logbook of its own runs (names and numbers, never code), with a switch to turn it off and a one-command way to delete it.",
            },
            {
              question:
                "Will it stop my agent from doing something it shouldn't?",
              answer:
                "No, and it doesn't claim to: discern never restricts what your agent can read, run, or change. Permissions belong to your agent's own controls. What discern adds is checked results, isolated changes, and your approval before anything lands.",
            },
            {
              question: "What if my project has no tests yet?",
              answer:
                "discern runs the commands you declare, and a formatter or linter is a fine start. The set can grow as the project does, and each new check applies to every change from then on.",
            },
          ]}
          aside={
            <p className="landing-faq-aside">
              Setup and troubleshooting questions live in the{" "}
              <a href="/docs/getting-started/faq">docs FAQ</a>. For anything
              else, <a href={`${GITHUB}/issues`}>open an issue</a>.
            </p>
          }
        />

        <CtaBand
          tone="accent"
          align="split"
          title="One command, then back to building"
          description="Install discern, tell your agent to set it up, and keep asking for what you want the way you already do."
          actions={
            <>
              <Button href="/docs/getting-started/quickstart" size="lg">
                Read the quickstart
              </Button>
              <Button href={GITHUB} size="lg" variant="secondary">
                View on GitHub
              </Button>
            </>
          }
          note={
            <>
              macOS and Linux, or Windows via WSL · Apache-2.0 ·{" "}
              <code>discern uninstall</code> keeps your content
            </>
          }
          visual={<InstallCommand />}
        />
      </main>

      <SiteFooter
        brand="discern"
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="Engineering habits for coding agents, run on your machine."
        groups={[
          {
            title: "Documentation",
            links: [
              { label: "Quickstart", href: "/docs/getting-started/quickstart" },
              { label: "Concepts", href: "/docs/orientation/concepts" },
              {
                label: "Trust & your data",
                href: "/docs/orientation/trust-and-data",
              },
              {
                label: "FAQ & troubleshooting",
                href: "/docs/getting-started/faq",
              },
            ],
          },
          {
            title: "Reference",
            links: [
              { label: "CLI reference", href: "/docs/reference/cli-reference" },
              {
                label: "Config reference",
                href: "/docs/reference/config-reference",
              },
              {
                label: "Files & ownership",
                href: "/docs/reference/artifact-ownership",
              },
              {
                label: "MCP tools & results",
                href: "/docs/reference/mcp-and-results",
              },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "GitHub", href: GITHUB },
              { label: "Releases", href: `${GITHUB}/releases/latest` },
              { label: "Report an issue", href: `${GITHUB}/issues` },
              { label: "License", href: `${GITHUB}/blob/main/LICENSE` },
            ],
          },
        ]}
        legal="Apache-2.0 licensed."
        meta="No network calls. No telemetry. One binary."
      />
    </>
  );
}

/** Render the homepage for static serving. */
export function renderLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "grain.css", "landing.css"],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingPage />),
  });
}
