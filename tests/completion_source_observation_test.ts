/** Source observation reads one mutable branch into immutable candidate coordinates. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { candidateAuthor } from "../src/engine/completion/candidate.ts";
import {
  observeSource,
  predecessorPolicyIdentity,
  recordedCandidate,
  retainCandidate,
  sameSource,
} from "../src/engine/completion/source.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import { CandidateSchema } from "../src/engine/completion/candidate.ts";
import { writeCompletionRecord } from "../src/engine/completion/store.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_CLOCK,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

Deno.test("source observation resolves the branch tip and tree and rejects a missing or unborn branch", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "authored\n");
    await gitInit(root);
    const branch = `refs/heads/${await gitOut(
      root,
      "symbolic-ref",
      "--short",
      "HEAD",
    )}`;
    const observed = await observeSource(root, "effort-a", branch);
    assertEquals(observed.head, await gitOut(root, "rev-parse", "HEAD"));
    assertEquals(
      observed.tree,
      await gitOut(root, "rev-parse", "HEAD^{tree}"),
    );
    assertEquals(observed.effort_id, "effort-a");
    assert(sameSource(observed, await observeSource(root, "effort-a", branch)));
    await git(root, "commit", "--allow-empty", "-m", "advance");
    const advanced = await observeSource(root, "effort-a", branch);
    assert(!sameSource(observed, advanced));
    assertEquals(
      advanced.tree,
      observed.tree,
      "an empty commit keeps its tree",
    );
    await assertRejects(
      () => observeSource(root, "effort-a", "refs/heads/absent"),
      Error,
    );
  });
});

Deno.test("policy identity digests the committed bytes even when they do not parse", async () => {
  await withTempDir(async (root) => {
    const broken = "[acceptance\npre_authorized = [\n";
    await Deno.writeTextFile(`${root}/discern.toml`, broken);
    await gitInit(root);
    const head = await gitOut(root, "rev-parse", "HEAD");
    assertEquals(
      await predecessorPolicyIdentity(root, head),
      await sha256Hex(broken),
      "an unparseable committed config still has an exact identity",
    );
    await git(root, "rm", "-q", "discern.toml");
    await git(root, "commit", "-q", "-m", "drop config", "--no-gpg-sign");
    assertEquals(
      await predecessorPolicyIdentity(
        root,
        await gitOut(root, "rev-parse", "HEAD"),
      ),
      await sha256Hex("absent-config"),
    );
    await assertRejects(
      () => predecessorPolicyIdentity(root, "refs/heads/absent"),
      Error,
    );
  });
});

Deno.test("recorded candidates match on every coordinate and select deterministically", () => {
  const fixture = completionFixtures().candidate;
  assert(fixture.kind === "candidate");
  const subject = {
    sources: fixture.data.sources,
    head: fixture.data.head,
    predecessor: fixture.data.predecessor,
    policy: fixture.data.policy,
    requirement_set: fixture.data.requirement_set,
  };
  const later = { ...fixture, id: completionId(9) };
  assertEquals(recordedCandidate([later, fixture], subject)?.id, fixture.id);
  assertEquals(recordedCandidate([fixture, later], subject)?.id, fixture.id);
  assertEquals(
    recordedCandidate([fixture], {
      ...subject,
      predecessor: "e".repeat(40),
    }),
    undefined,
  );
  assertEquals(
    recordedCandidate([fixture], {
      ...subject,
      sources: [{ ...candidateAuthor(fixture.data), head: "e".repeat(40) }],
    }),
    undefined,
  );
  assertEquals(
    recordedCandidate([fixture], { ...subject, policy: "e".repeat(64) }),
    undefined,
  );
});

Deno.test("candidate retention requires the observing attempt's own live claim", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "authored\n");
    await gitInit(root);
    const fixtures = completionFixtures();
    const candidateRecord = fixtures.candidate;
    assert(candidateRecord.kind === "candidate");
    const candidate = CandidateSchema.parse(candidateRecord.data);
    const fence = {
      attempt_id: completionId(2),
      token: COMPLETION_CLAIM.token,
    };
    await assertRejects(
      () => retainCandidate(root, candidateRecord.id, candidate, fence),
      Error,
      "Candidate belongs to another attempt identity.",
      "retention needs the attempt on record first",
    );
    await assertRejects(
      () =>
        retainCandidate(root, candidateRecord.id, candidate, {
          ...fence,
          attempt_id: completionId(99),
        }),
      Error,
      "Candidate names another attempt.",
    );
    const attempt = await writeCompletionRecord(
      root,
      fixtures.attempt,
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(attempt.kind === "written", JSON.stringify(attempt));
    await assertRejects(
      () => retainCandidate(root, completionId(90), candidate, fence),
      Error,
      "Candidate belongs to another attempt identity.",
      "the attempt's own candidate coordinate binds retention",
    );
    // The real store enforces the live-claim clock; a system clock past the
    // fixture claim expiry refuses publication rather than recording it.
    await assertRejects(
      () => retainCandidate(root, candidateRecord.id, candidate, fence),
      Error,
      "Candidate publication claim-lost",
    );
  });
});
