import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Find every direct production reservation outside its lifecycle authority. */
async function reservationCallSites(): Promise<
  readonly { path: string; source: string; offset: number }[]
> {
  const files = await structuralGuardScope({
    guard:
      "tests/completion_attempt_lease_guard_test.ts#reserved-claim-lifecycle",
    universe: "authored-ts",
    narrow: {
      reason:
        "Completion-attempt reservations are a production engine invariant; tests and unrelated authored modules do not own claims.",
      include: (path) =>
        path.startsWith("src/engine/") &&
        path !== "src/engine/completion/attempt_lifecycle.ts",
    },
  });
  const sites: { path: string; source: string; offset: number }[] = [];
  for (const path of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    for (const match of source.matchAll(/\breserveAttempt\s*\(/gu)) {
      if (match.index !== undefined) {
        sites.push({ path, source, offset: match.index });
      }
    }
  }
  return sites;
}

Deno.test("every completion-attempt reservation enters renewable ownership", async () => {
  const sites = await reservationCallSites();
  assert(sites.length > 0, "the guard must observe the production lifecycle");
  for (const site of sites) {
    assert(
      site.source.slice(site.offset, site.offset + 1_600).includes(
        "withAttemptClaim(",
      ),
      `${site.path}: reserveAttempt must immediately enter withAttemptClaim`,
    );
  }
});

/** A claim's lease read anywhere: its stored fields, its expiry, or its length. */
const LEASE_FACT =
  /\bclaim\??\.(?:expires_at|renewed_at)\b|\beffectiveClaimExpiry\s*\(|\bATTEMPT_CLAIM_LEASE_MS\b/gu;

/** Reporting a lease's expiry as a fact is the one read allowed outside the model. */
const REPORTED_EXPIRY = /\bexpires_at:\s*$/u;

Deno.test("only the claim model compares a lease with a clock", async () => {
  // An ownership check that reads the lease turns a stalled owner nobody
  // retired into a lost claim. The claim model owns lease arithmetic and the
  // takeover decision; everywhere else asks it whether a record names a claim.
  const files = await structuralGuardScope({
    guard:
      "tests/completion_attempt_lease_guard_test.ts#lease-facts-stay-in-the-claim-model",
    universe: "authored-ts",
    narrow: {
      reason:
        "Attempt claims are production engine state; the claim model itself and tests that stage stalls and takeovers construct leases deliberately.",
      include: (path) =>
        path.startsWith("src/") &&
        path !== "src/engine/completion/attempt.ts",
    },
  });
  const findings: string[] = [];
  let reported = 0;
  for (const path of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    for (const match of source.matchAll(LEASE_FACT)) {
      const before = source.slice(
        source.lastIndexOf("\n", match.index) + 1,
        match.index,
      );
      if (
        match[0].startsWith("effectiveClaimExpiry") &&
        REPORTED_EXPIRY.test(before)
      ) {
        reported += 1;
        continue;
      }
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${path}:${line}: ${match[0]}`);
    }
  }
  assert(reported > 0, "the guard must observe the reported expiry");
  assertEquals(
    findings,
    [],
    "Decide ownership with attemptHoldsClaim and takeover with claimTakeoverPermitted; report an expiry only as `expires_at: effectiveClaimExpiry(…)`.",
  );
});
