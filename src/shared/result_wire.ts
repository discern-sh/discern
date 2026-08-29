/**
 * Compact, schema-backed projections for serialized result surfaces.
 *
 * Verb cores keep the complete in-process data their terminal renderers need.
 * CLI JSON and MCP cross this boundary once, where rendered artifacts that
 * duplicate structured evidence are removed. The matching wire schemas live in
 * `result_schemas.ts`.
 */

/** Internal result policy available to a wire projector, never serialized. */
export interface ResultWireSource {
  readonly wireProjection?: "full" | undefined;
}

/** One optional per-contract transformation at the serialization boundary. */
export type ResultWireProjector = (
  result: Record<string, unknown>,
  source?: ResultWireSource,
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

const REQUIRED_PROOF_SUMMARY_FIELDS = [
  "branch",
  "trunk",
  "head",
  "files_total",
  "insertions",
  "deletions",
  "line",
] as const;

const PROOF_SUMMARY_FIELDS = [
  ...REQUIRED_PROOF_SUMMARY_FIELDS,
  "mode",
  "checkpoint_drops",
  "standard_proposals",
] as const;

/** Remove the review-page rendering while retaining every compact Proof fact. */
function proofSummary(value: unknown): Record<string, unknown> | undefined {
  const proof = object(value);
  return proof === undefined
    ? undefined
    : copyDefined(proof, PROOF_SUMMARY_FIELDS);
}

const STATUS_AUTHORITY_PATH_LIMIT = 6;
const STATUS_ORIENTATION_LIST_LIMIT = 6;

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
    "uncovered_scopes",
    "uncovered_unscoped_total",
    "uncovered_generated_total",
    "warnings",
  ]);
  if (Array.isArray(authority.uncovered)) {
    // Authored paths make the more actionable examples; generated paths stay
    // countable through uncovered_generated_total.
    const authored = authority.uncovered.filter((entry) =>
      object(entry)?.generated !== true
    );
    const generated = authority.uncovered.filter((entry) =>
      object(entry)?.generated === true
    );
    out.uncovered = [...authored, ...generated]
      .slice(0, STATUS_AUTHORITY_PATH_LIMIT);
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
  "checkpoint_drops",
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
    REQUIRED_PROOF_SUMMARY_FIELDS.every((field) => proof[field] !== undefined)
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

/** Project one status payload without its nested rendered Proof copies. */
function compactStatusData(
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

const STATUS_ORIENTATION_FLEET_FIELDS = [
  "path",
  "is_main",
  "is_current",
  "branch",
  "registration",
  "branch_reachable",
  "filesystem",
  "clean",
  "changed_files",
  "ahead",
  "behind",
  "last_activity",
  "last_action",
  "running",
  "contained_in",
  "git_unavailable",
  "git_failure",
  "id",
  "port",
  "broken",
  "setup",
  "gate_proof",
  "landing_authority",
] as const;

/**
 * Bound every repeated collection recursively. This is deliberately shape-
 * generic: a future status array enrolls without joining a hand-copied field
 * list. The fleet has its own main-plus-six sampling rule below.
 */
function orientRepeatedValue(
  value: unknown,
  path: string,
  omitted: Record<string, number>,
): unknown {
  if (Array.isArray(value)) {
    const sampled = value.slice(0, STATUS_ORIENTATION_LIST_LIMIT);
    if (value.length > sampled.length) {
      omitted[path] = value.length - sampled.length;
    }
    return sampled.map((entry, index) =>
      orientRepeatedValue(entry, `${path}[${index}]`, omitted)
    );
  }
  const record = object(value);
  if (record === undefined) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      orientRepeatedValue(
        entry,
        path === "" ? key : `${path}.${key}`,
        omitted,
      ),
    ]),
  );
}

/** Bound the default status payload to the facts needed for agent orientation. */
function orientStatusData(
  compact: Record<string, unknown>,
): Record<string, unknown> {
  const omitted: Record<string, number> = {};
  const orientationSource: Record<string, unknown> = { ...compact };

  // Landing history is review detail rather than session orientation. Its
  // availability is advertised by the projection hint and explicit full mode.
  delete orientationSource.landed_proof;
  delete orientationSource.landed_proof_unsupported;
  delete orientationSource.fleet;
  const projected = orientRepeatedValue(
    orientationSource,
    "",
    omitted,
  ) as Record<string, unknown>;

  const worktree = object(projected.worktree);
  const resources = object(worktree?.resources);
  if (worktree !== undefined && resources !== undefined) {
    const entries = Object.entries(resources);
    if (entries.length > STATUS_ORIENTATION_LIST_LIMIT) {
      projected.worktree = {
        ...worktree,
        resources: Object.fromEntries(
          entries.slice(0, STATUS_ORIENTATION_LIST_LIMIT),
        ),
      };
      omitted["worktree.resources"] = entries.length -
        STATUS_ORIENTATION_LIST_LIMIT;
    }
  }

  const fleet = Array.isArray(compact.fleet) ? compact.fleet : undefined;
  if (fleet !== undefined) {
    const rows = fleet.flatMap((entry) => {
      const row = object(entry);
      return row === undefined ? [] : [row];
    });
    const main = rows.filter((row) => row.is_main === true);
    const active = rows.filter((row) => row.is_main !== true);
    const sampled = [
      ...main.slice(0, 1),
      ...active.slice(0, STATUS_ORIENTATION_LIST_LIMIT),
    ];
    projected.fleet = sampled.map((row, index) =>
      orientRepeatedValue(
        copyDefined(row, STATUS_ORIENTATION_FLEET_FIELDS),
        `fleet[${index}]`,
        omitted,
      )
    );
    projected.fleet_total = active.length;
    const hidden = rows.length - sampled.length;
    if (hidden > 0) {
      omitted.fleet = hidden;
    }
  }

  projected.projection = {
    mode: "orientation",
    ...(Object.keys(omitted).length === 0 ? {} : { omitted }),
  };
  return projected;
}

/** Project one status payload for JSON, Markdown, MCP, or the status resource. */
export function projectStatusData(
  data: Record<string, unknown>,
  options: { readonly full?: boolean } = {},
): Record<string, unknown> {
  const compact = compactStatusData(data);
  return options.full === true
    ? { ...compact, projection: { mode: "full" } }
    : orientStatusData(compact);
}

/** `status`: default to orientation; explicit verbose requests full detail. */
export const projectStatusResult: ResultWireProjector = (
  result: Record<string, unknown>,
  source: ResultWireSource | undefined,
): Record<string, unknown> =>
  projectData(
    result,
    (data) =>
      projectStatusData(data, {
        full: source?.wireProjection === "full",
      }),
  );

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

/** The closed set of verbs whose compact form drops redundant presentation data. */
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
