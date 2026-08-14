/**
 * Compact, schema-backed projections for agent result surfaces.
 *
 * Verb cores keep the complete in-process data their terminal renderers need.
 * CLI JSON and MCP cross this boundary once, where rendered artifacts that
 * duplicate structured evidence are removed. The matching wire schemas live in
 * `result_schemas.ts`.
 */

/** One optional per-contract transformation at the serialization boundary. */
export type ResultWireProjector = (
  result: Record<string, unknown>,
) => Record<string, unknown>;

/** Narrow one unknown wire value to a plain object. */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Copy a fixed field set, omitting absent values. */
function copyDefined(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

const PROOF_SUMMARY_FIELDS = [
  "branch",
  "trunk",
  "head",
  "files_total",
  "insertions",
  "deletions",
  "line",
] as const;

/** Remove the review-page rendering while retaining every compact Proof fact. */
function proofSummary(value: unknown): Record<string, unknown> | undefined {
  const proof = object(value);
  return proof === undefined
    ? undefined
    : copyDefined(proof, PROOF_SUMMARY_FIELDS);
}

const STATUS_AUTHORITY_PATH_LIMIT = 6;

/** Bound path-level landing evidence while retaining the exact stop decision. */
function landingAuthoritySummary(
  value: unknown,
): Record<string, unknown> | undefined {
  const authority = object(value);
  if (authority === undefined) {
    return undefined;
  }
  const out = copyDefined(authority, [
    "kind",
    "source",
    "scopes",
    "standing_scopes",
    "warnings",
  ]);
  if (Array.isArray(authority.uncovered)) {
    out.uncovered = authority.uncovered.slice(0, STATUS_AUTHORITY_PATH_LIMIT);
    out.uncovered_total = authority.uncovered.length;
  }
  return out;
}

const GATE_PROOF_STATE_FIELDS = [
  "status",
  "path",
  "recorded",
  "head",
  "reason",
] as const;

/** Project a marker inspection without its rendered page or duplicate full Proof. */
function gateProofSummary(value: unknown): Record<string, unknown> | undefined {
  const check = object(value);
  if (check === undefined) {
    return undefined;
  }
  const out = copyDefined(check, GATE_PROOF_STATE_FIELDS);
  const proof = proofSummary(check.proof_data);
  if (
    proof !== undefined &&
    Object.keys(proof).length === PROOF_SUMMARY_FIELDS.length
  ) {
    out.proof = proof;
  } else if (typeof check.proof_line === "string") {
    // Older marker writers carried presentation only. Keep their bounded line
    // instead of pretending the missing structured facts exist.
    out.proof_line = check.proof_line;
  }
  return out;
}

/** Replace one envelope's data payload with its wire projection. */
function projectData(
  result: Record<string, unknown>,
  project: (data: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const data = object(result.data);
  return data === undefined ? result : { ...result, data: project(data) };
}

/** `done`: retain the compact Proof claim and discard its review-page rendering. */
export const projectGateResult: ResultWireProjector = (
  result: Record<string, unknown>,
): Record<string, unknown> =>
  projectData(result, (data) => {
    const proof = proofSummary(data.proof);
    const landingAuthority = landingAuthoritySummary(data.landing_authority);
    return {
      ...data,
      ...(proof === undefined ? {} : { proof }),
      ...(landingAuthority === undefined
        ? {}
        : { landing_authority: landingAuthority }),
    };
  });

/** Project one status payload for JSON, Markdown, MCP, or the status resource. */
export function projectStatusData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...data };

  const gateProof = gateProofSummary(data.gate_proof);
  if (gateProof !== undefined) {
    projected.gate_proof = gateProof;
  }

  const landingAuthority = landingAuthoritySummary(data.landing_authority);
  if (landingAuthority !== undefined) {
    projected.landing_authority = landingAuthority;
  }

  const landed = object(data.landed_proof);
  if (landed !== undefined) {
    const proof = proofSummary(landed.proof);
    projected.landed_proof = {
      ...copyDefined(landed, ["commit", "commit_at", "ref", "issuer", "brief"]),
      ...(proof === undefined ? {} : { proof }),
    };
  }

  if (Array.isArray(data.fleet)) {
    projected.fleet = data.fleet.map((entry) => {
      const row = object(entry);
      if (row === undefined) {
        return entry;
      }
      const {
        proof: _proof,
        proof_line: _proofLine,
        proof_honored: _proofHonored,
        gate_proof: rawGateProof,
        ...rest
      } = row;
      const projectedGateProof = gateProofSummary(rawGateProof);
      const projectedAuthority = landingAuthoritySummary(
        rest.landing_authority,
      );
      return {
        ...rest,
        ...(projectedAuthority === undefined
          ? {}
          : { landing_authority: projectedAuthority }),
        ...(projectedGateProof === undefined
          ? {}
          : { gate_proof: projectedGateProof }),
      };
    });
  }

  if (Array.isArray(data.fleet_collisions)) {
    projected.fleet_collisions = data.fleet_collisions.map((entry) => {
      const collision = object(entry);
      return collision === undefined
        ? entry
        : copyDefined(collision, ["branches", "total"]);
    });
  }

  if (Array.isArray(data.adr_collisions)) {
    projected.adr_collisions = data.adr_collisions.map((entry) => {
      const collision = object(entry);
      return collision === undefined
        ? entry
        : copyDefined(collision, ["number", "branches"]);
    });
  }

  return projected;
}

/** `status`: remove every nested rendered Proof copy at the wire boundary. */
export const projectStatusResult: ResultWireProjector = (
  result: Record<string, unknown>,
): Record<string, unknown> => projectData(result, projectStatusData);

/** `accept`: keep landing evidence and the one-line Proof, not the PR-body page. */
export const projectAcceptResult: ResultWireProjector = (
  result: Record<string, unknown>,
): Record<string, unknown> =>
  projectData(result, (data) => {
    const { proof: _proof, gate_validation: rawValidation, ...rest } = data;
    const validation = object(rawValidation);
    if (validation === undefined) {
      return rest;
    }
    const proof = gateProofSummary(validation.proof);
    return {
      ...rest,
      gate_validation: {
        ...copyDefined(validation, ["mode"]),
        ...(proof === undefined ? {} : { proof }),
      },
    };
  });

/** The closed set of verbs whose agent wire drops redundant presentation data. */
const RESULT_WIRE_PROJECTORS: Readonly<Record<string, ResultWireProjector>> =
  Object.freeze({
    done: projectGateResult,
    status: projectStatusResult,
    accept: projectAcceptResult,
  });

/** Resolve the compacting projection for one result discriminator. */
export function resultWireProjectorForVerb(
  verb: string,
): ResultWireProjector | undefined {
  return RESULT_WIRE_PROJECTORS[verb];
}
