/**
 * Discern-authored commit enrolment guard.
 *
 * The defect class is any production TypeScript path that invokes `git commit`
 * without passing through the shared discern-commit boundary. The scan reads
 * every authored TypeScript file, so a fresh source root and a fresh-named
 * caller enrol automatically. Test code is fixture machinery rather than
 * production behavior and stays outside the scan.
 *
 * `scripts/release_smoke.ts` has one narrower exception: it creates the
 * temporary repository the compiled-binary smoke test runs against. That
 * fixture commit is not a diff discern composes in a user's repository. The
 * exception admits only its one subject; another commit in that script fails.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DISCERN_BOT } from "../src/shared/brand.ts";
import {
  DISCERN_AUTHORED_COMMIT_SITES,
  discernCommitMessage,
} from "../src/shared/discern_commit.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { fakeEnv } from "./helpers.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

interface AuthoredSource {
  readonly rel: string;
  readonly text: string;
}

interface RawCommitSite {
  readonly rel: string;
  readonly line: number;
  readonly tail: string;
}

const DISCERN_COMMIT_HOME = "src/shared/discern_commit.ts";
const RELEASE_FIXTURE = "scripts/release_smoke.ts";
const RELEASE_FIXTURE_SUBJECT = "Create release smoke fixture";

/** An argv array whose first member is the `git commit` subcommand. */
const RAW_COMMIT_ARGV = /\[\s*["']commit["']\s*(?:,|\])/g;
const DISCERN_COMMIT_CALL = /\bcommitDiscernChanges\s*\(\s*\{/g;
const COMMIT_SITE_REF =
  /site:\s*DISCERN_AUTHORED_COMMIT_SITES\.([A-Za-z][A-Za-z0-9]*)/;

function rawCommitSites(sources: readonly AuthoredSource[]): RawCommitSite[] {
  const sites: RawCommitSite[] = [];
  for (const source of sources) {
    for (const match of source.text.matchAll(RAW_COMMIT_ARGV)) {
      const at = match.index;
      sites.push({
        rel: source.rel,
        line: source.text.slice(0, at).split("\n").length,
        tail: source.text.slice(at, at + 180),
      });
    }
  }
  return sites;
}

function rawCommitOffenders(
  sources: readonly AuthoredSource[],
): string[] {
  const sites = rawCommitSites(sources);
  const helperSites = sites.filter((site) => site.rel === DISCERN_COMMIT_HOME);
  const fixtureSites = sites.filter((site) => site.rel === RELEASE_FIXTURE);
  const offenders = sites
    .filter((site) =>
      site.rel !== DISCERN_COMMIT_HOME && site.rel !== RELEASE_FIXTURE
    )
    .map((site) => `${site.rel}:${site.line}`);

  if (helperSites.length !== 1) {
    offenders.push(
      `${DISCERN_COMMIT_HOME}: expected the one production git-commit invocation, found ${helperSites.length}`,
    );
  }
  if (
    fixtureSites.length !== 1 ||
    !fixtureSites[0]?.tail.includes(RELEASE_FIXTURE_SUBJECT)
  ) {
    offenders.push(
      `${RELEASE_FIXTURE}: expected only the release-smoke fixture commit`,
    );
  }
  return offenders.sort();
}

async function productionSources(): Promise<AuthoredSource[]> {
  const sources: AuthoredSource[] = [];
  for (const rel of AUTHORED_TS_FILES) {
    if (rel.startsWith("tests/")) continue;
    sources.push({
      rel,
      text: await Deno.readTextFile(join(REPO_ROOT, rel)),
    });
  }
  return sources;
}

Deno.test("every production git commit routes through the discern commit boundary", async () => {
  const offenders = rawCommitOffenders(await productionSources());
  assertEquals(
    offenders,
    [],
    "raw production git commits bypass the attribution boundary; call " +
      `commitDiscernChanges() from ${DISCERN_COMMIT_HOME}. The sole fixture ` +
      `exception is the named temporary-repository commit in ${RELEASE_FIXTURE}:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("every canonical discern-authored commit site has one production caller", async () => {
  const uses: string[] = [];
  const unclassified: string[] = [];
  for (const source of await productionSources()) {
    for (const match of source.text.matchAll(DISCERN_COMMIT_CALL)) {
      const line = source.text.slice(0, match.index).split("\n").length;
      const tail = source.text.slice(match.index, match.index + 500);
      const site = tail.match(COMMIT_SITE_REF)?.[1];
      if (site === undefined) {
        unclassified.push(`${source.rel}:${line}`);
      } else {
        uses.push(site);
      }
    }
  }
  const expected = Object.keys(DISCERN_AUTHORED_COMMIT_SITES).sort();
  assertEquals(
    unclassified,
    [],
    "a commitDiscernChanges() call does not name its canonical site:\n  " +
      unclassified.join("\n  "),
  );
  assertEquals(
    uses.sort(),
    expected,
    "discern-authored commit callers and DISCERN_AUTHORED_COMMIT_SITES " +
      "differ; add the site to the registry and route it through the helper, " +
      "or remove the stale registry member",
  );
});

Deno.test("the commit guard enrolls an unrelated future production caller", () => {
  const sources: AuthoredSource[] = [
    {
      rel: DISCERN_COMMIT_HOME,
      text: 'return runGit(["commit", "-m", message], { cwd });',
    },
    {
      rel: RELEASE_FIXTURE,
      text:
        'await run("git", ["commit", "-m", "Create release smoke fixture"]);',
    },
    {
      rel: "tools/harbor/ledger.ts",
      text:
        'await ferry(["commit", "-m", "Record unrelated migration"], quay);',
    },
  ];
  assertEquals(rawCommitOffenders(sources), ["tools/harbor/ledger.ts:1"]);
});

Deno.test("discern commit messages use an injectable non-empty opt-out", () => {
  const attributed = discernCommitMessage("Subject", "Body", fakeEnv());
  assertEquals(
    attributed,
    `Subject\n\nBody\n\n${DISCERN_BOT.trailer}`,
  );
  assertEquals(
    discernCommitMessage(
      "Subject",
      "Body",
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    ),
    "Subject\n\nBody",
  );
  assertEquals(
    discernCommitMessage(
      "Subject",
      undefined,
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "" }),
    ),
    `Subject\n\n${DISCERN_BOT.trailer}`,
  );
});
