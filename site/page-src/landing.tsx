/**
 * The authored homepage: the landing argument delivered as a typeset essay.
 * site/build.ts renders it to static HTML; the technical substantiation lives
 * in real footnotes.
 */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArticleHeader,
  ArticleLayout,
  Brand,
  Button,
  DataFigure,
  Footnotes,
  HeadingAccent,
  LogoCloud,
  Prose,
  PullQuote,
  RelatedContent,
  SiteFooter,
  SkipLink,
  TableOfContents,
  Terminal,
  Transcript,
  Window,
  Worklog,
} from "discern-design-system/react";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";
import { INSTALL_COMMAND, SETUP_SENTENCE } from "./install-command.tsx";

const GITHUB = "https://github.com/jackwh/discern";

/** A superscript marker linking one claim to its note, with a return anchor. */
function Note({ n }: { readonly n: number }) {
  return (
    <sup className="landing-fnref" id={`fnref-${n}`}>
      <a href={`#note-${n}`} aria-label={`Note ${n}`}>{n}</a>
    </sup>
  );
}

/** One numbered end-note whose backlink returns to the marker. */
function note(n: number, content: ReactNode) {
  return { id: `note-${n}`, backHref: `#fnref-${n}`, content };
}

/** Static theme toggle wired at runtime by the shared /assets/theme.js. */
function LandingThemeToggle() {
  return (
    <button
      type="button"
      className="discern-theme-toggle landing-masthead__theme"
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

/** Figure 1: the loop between an ask and a checked report. */
function CheckedAskFigure() {
  return (
    <DataFigure
      className="landing-figure"
      eyebrow="Figure 1"
      title="One ask, checked"
      surface="sunken"
      visual={
        <Window
          title="your-project · agent session"
          className="landing-session"
        >
          <Transcript
            className="landing-session__chat"
            turns={[
              { speaker: "You", body: "Fix the upload bug." },
              {
                speaker: "Your agent",
                body: (
                  <Worklog
                    entries={[
                      {
                        label: "Opened a separate workspace",
                        status: "done",
                        detail: "agent/fix-upload-retry",
                      },
                      {
                        label: "Found the cause in the retry path",
                        status: "done",
                      },
                      {
                        label: "Wrote a test that fails without the fix",
                        status: "done",
                      },
                      {
                        label: "Ran your project's checks",
                        status: "failed",
                        detail: "lint: unused import in upload.ts",
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
                  "The bug is fixed and covered by a new test. Every check passed on the final version. Review when ready.",
              },
            ]}
          />
        </Window>
      }
      legend={[
        { label: "check passed", tone: "success" },
        { label: "check caught a break", tone: "warning" },
      ]}
      caption="The loop between your ask and the agent's report: an isolated workspace, the project's checks, one caught failure, a verified finish."
      source={
        <a href="/docs/getting-started/walkthrough">
          The full session, narrated, is in the setup walkthrough.
        </a>
      }
    />
  );
}

function LandingPage() {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <header className="landing-masthead">
        <a href="/" className="landing-masthead__brand">
          <Brand mark={DISCERN_MARK} name="discern" size="lg" typeface="mono" />
        </a>
        <nav className="landing-masthead__nav" aria-label="Site">
          <a href="/docs">Docs</a>
          <a href={GITHUB}>GitHub ↗</a>
          <LandingThemeToggle />
        </nav>
      </header>
      <main id="main">
        <ArticleHeader
          className="landing-header"
          eyebrow="A discern essay"
          title={
            <>
              On keeping software <HeadingAccent>changeable</HeadingAccent>
            </>
          }
          standfirst="Anyone can ask a coding agent for software and watch it appear. The harder question arrives later: whether a project made of many asks stays sound. That discipline can belong to the agent, and this essay is about how."
          meta={["discern.sh", "July 2026"]}
          actions={
            <>
              <Button href="#one-command">Install discern</Button>
              <Button href="/docs" variant="secondary">Read the manual</Button>
            </>
          }
        />
        <ArticleLayout
          className="landing-body"
          navigation={
            <TableOfContents
              title="In this essay"
              items={[
                { label: "The ask", href: "#the-ask" },
                { label: "The pattern", href: "#the-pattern" },
                { label: "The habits", href: "#the-habits" },
                { label: "The agent, equipped", href: "#the-agent-equipped" },
                { label: "What you keep", href: "#what-you-keep" },
                { label: "One command", href: "#one-command" },
                { label: "Notes", href: "#notes" },
              ]}
            />
          }
        >
          <div className="landing-flow">
            <Prose className="landing-prose">
              <h2 id="the-ask">The ask</h2>
            </Prose>
            <Prose dropCap className="landing-prose landing-opening-copy">
              <p>
                Somewhere in the past two years, building software stopped
                requiring you to write it. You describe what you want: a booking
                page for the studio, an invoice exporter, sign-in with Google. A
                coding agent writes the code, and the thing appears on your
                screen. If you haven't felt the small shock of watching a
                working feature assemble itself out of a sentence, it's worth
                feeling once.
              </p>
              <p>
                A first version now takes an afternoon. Every version after it
                still takes discipline: the fix that has to respect March's
                feature, the redesign that can't disturb payments, the fiftieth
                ask that has to live peacefully with the forty-nine before it.
              </p>
              <h2 id="the-pattern">The pattern</h2>
              <p>
                Projects built by asking tend to fray in a recognizable order. A
                fix over here breaks something over there, because nothing
                re-checked the parts nobody was looking at. The agent forgets a
                convention you set three chats ago, so you repeat it, and then
                repeat it again. Done gets announced a little before it's true.
                And the mood of the project shifts: each new ask carries a
                little more wariness about what it might undo.
              </p>
              <p>
                None of this is a failure of yours, or of the agent's talent.
                It's what happens to any codebase that grows faster than its
                habits.
              </p>

              <h2 id="the-habits">The habits</h2>
              <p>
                Software teams that survive years of change do it with a short
                list of unglamorous habits. Work happens away from the copy
                people rely on. Every change faces the project's checks before
                it counts. Failures come back specific enough to act on. The
                house rules are written down where everyone can read them. And a
                person answers for what lands.
              </p>
              <p>
                Nothing on that list requires brilliance. It requires
                consistency, and consistency is what machines are for. discern
                is built on that premise: the habits belong with whoever does
                the work, and in your project the work is now done by an agent.
              </p>

              <h2 id="the-agent-equipped">The agent, equipped</h2>
              <p>
                With discern installed, your agent works to the list above
                without being reminded. It takes each task into a separate copy
                of the project<Note n={1} />, away from the version you rely on.
                Before it reports anything, it runs the checks your project
                declares<Note n={2} />. When one fails, the failure comes back
                as the failing command and its captured output
                <Note n={3} />, so the agent fixes the problem and runs the loop
                again. A pass is recorded against the version that passed
                <Note n={4} />. And it waits for your approval before anything
                lands<Note n={5} />.
              </p>
            </Prose>

            <PullQuote
              className="landing-pull"
              align="wide"
              quote="Nothing lands until you say so."
            />

            <Prose className="landing-prose">
              <p>
                The rules you teach the project are written once and compiled
                into the instructions every configured agent reads
                <Note n={6} />, so the convention you set in March is still in
                force in July, in a new chat, on a different agent.
              </p>
            </Prose>

            <CheckedAskFigure />

            <Prose className="landing-prose">
              <h2 id="what-you-keep">What you keep</h2>
              <p>
                All of it happens on your machine. discern makes no network
                calls after install and sends no telemetry<Note n={7} />. The
                checks are commands you declared, in a file you can read. The
                files it writes sit inside a small, enumerated footprint, and a
                test in discern's own build fails if anything writes outside
                it<Note n={8} />.
              </p>
              <p>
                The boundaries are worth stating plainly. discern doesn't
                restrict what your agent can read, run, or change; permissions
                stay with your agent's own controls. And discern makes one
                promise, kept narrow on purpose: the checks you declared ran,
                passed, and were recorded against the version you're looking at.
              </p>
              <p>
                The cost is time. A checked change arrives slower than an
                unchecked one, because checking, fixing, and re-checking sit
                inside the loop. The bet is that minutes spent there beat
                evenings spent untangling a break you find later.
              </p>

              <h2 id="one-command">One command</h2>
              <p>
                discern ships as one self-contained binary; Git is the only
                other requirement. Install it, then tell your agent:{" "}
                <em>“{SETUP_SENTENCE}”</em>{" "}
                Setup asks before it writes anything, does its work on a branch
                you can read, and <code>discern uninstall</code>{" "}
                removes it if you change your mind.
              </p>
            </Prose>

            <div className="landing-install">
              <div
                className="landing-install__terminal-host"
                data-copy-command={INSTALL_COMMAND}
              >
                <Terminal
                  title="terminal"
                  className="landing-install__terminal"
                >
                  {`$ ${INSTALL_COMMAND}

# then, in your coding agent:
> ${SETUP_SENTENCE}`}
                </Terminal>
              </div>
              <p className="landing-install__note">
                Works with Claude Code, Codex, Gemini, Cursor, and GitHub
                Copilot, on macOS and Linux, or Windows via WSL.
              </p>
            </div>

            <Footnotes
              id="notes"
              className="landing-notes"
              title="Notes"
              items={[
                note(
                  1,
                  <>
                    Each task's workspace is a Git worktree on its own branch
                    (prefix{" "}
                    <code>agent/</code>), with a deterministic port and any
                    per-worktree resources the project declares.{" "}
                    <code>discern start</code> creates it; landing removes it.
                  </>,
                ),
                note(
                  2,
                  <>
                    The format, build, lint, type-check, test, and smoke
                    commands named in{" "}
                    <code>discern.toml</code>, plus custom jobs.{" "}
                    <code>discern done</code>{" "}
                    runs them together; discern brings no test suite of its own.
                  </>,
                ),
                note(
                  3,
                  <>
                    Structured diagnostics carry the tool, the failing command,
                    and its captured output.
                  </>,
                ),
                note(
                  4,
                  <>
                    A green <code>discern done</code>{" "}
                    on a clean, committed branch records a receipt for that
                    commit. Any later edit lapses it, and acceptance re-runs the
                    checks instead.
                  </>,
                ),
                note(
                  5,
                  <>
                    <code>discern accept</code>{" "}
                    fast-forwards the main branch to the reviewed branch only
                    after your confirmation, then removes the workspace.
                  </>,
                ),
                note(
                  6,
                  <>
                    One authored source compiles into the file each configured
                    agent reads (Claude Code, Codex, Gemini, Cursor, and GitHub
                    Copilot); focused skills materialize alongside.
                  </>,
                ),
                note(
                  7,
                  <>
                    After the HTTPS download at install time, discern works
                    fully offline. Its one local record, the logbook, holds
                    names and numbers about discern's own runs, has an off
                    switch, and can reach no network interface: a test in
                    discern's own build fails if that changes. Details in{" "}
                    <a href="/docs/orientation/trust-and-data">
                      Trust &amp; your data
                    </a>.
                  </>,
                ),
                note(
                  8,
                  <>
                    The complete inventory of written files is in{" "}
                    <a href="/docs/reference/artifact-ownership">
                      Files &amp; ownership
                    </a>. <code>discern uninstall</code>{" "}
                    removes the wiring and keeps your content.
                  </>,
                ),
              ]}
            />
          </div>
        </ArticleLayout>

        <LogoCloud
          label="Placeholder logos"
          aria-label="Six placeholder logos"
          items={[
            { name: "Logo 01", mark: "◮" },
            { name: "Logo 02", mark: "◆" },
            { name: "Logo 03", mark: "●" },
            { name: "Logo 04", mark: "■" },
            { name: "Logo 05", mark: "✦" },
            { name: "Logo 06", mark: "◇" },
          ]}
        />

        <RelatedContent
          className="landing-related"
          eyebrow="Keep reading"
          title="The precise versions of these claims"
          surface="sunken"
          items={[
            {
              eyebrow: "Guide",
              title: "Quickstart",
              description:
                "Install the binary, hand setup to your agent, and land your first checked change.",
              href: "/docs/getting-started/quickstart",
            },
            {
              eyebrow: "Concepts",
              title: "How discern fits together",
              description:
                "The mental model in one read: the checks, the worktrees, and who owns which files.",
              href: "/docs/orientation/concepts",
            },
            {
              eyebrow: "Reference",
              title: "Trust & your data",
              description:
                "What discern does and does not do on your machine, held by tests rather than promises.",
              href: "/docs/orientation/trust-and-data",
            },
          ]}
        />
      </main>
      <SiteFooter
        brand="discern"
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="One binary that gives your repository a definition of done, an isolated worktree per change, and one set of instructions every agent reads."
        groups={[
          {
            title: "Documentation",
            links: [
              {
                label: "Quickstart",
                href: "/docs/getting-started/quickstart",
              },
              { label: "Concepts", href: "/docs/orientation/concepts" },
              { label: "The quality gate", href: "/docs/quality-gate" },
              {
                label: "Trust & your data",
                href: "/docs/orientation/trust-and-data",
              },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "GitHub", href: GITHUB },
              { label: "Releases", href: `${GITHUB}/releases/latest` },
              { label: "Decisions", href: "/docs/decisions" },
              { label: "FAQ", href: "/docs/getting-started/faq" },
            ],
          },
        ]}
        legal="Open source under Apache-2.0."
        meta="macOS · Linux · WSL2"
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
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "landing.css",
    ],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingPage />),
  });
}
