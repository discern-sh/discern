/**
 * Contract-validating JSON decoders for test fixtures and discern CLI stdout.
 *
 * Command results resolve their Zod schema through the public result-contract
 * registry, so a test cannot silently consume a shape the command no longer
 * promises. A command result is decoded from its whole finished run, so a run
 * that crashed or printed nothing fails with its exit code and stderr instead
 * of an opaque parse error. Non-envelope JSON crosses the same
 * parse-and-validate boundary via {@link decodeWith}.
 */

import type { z } from "@zod/zod";
import {
  CLI_JSON_RESULT_CONTRACTS,
  type RegisteredCliJsonResultContract,
} from "../src/shared/result_contracts.ts";

const EXCERPT_MAX_CHARS = 400;

/** A finished CLI process: its exit code and both captured output streams. */
export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

type CliResultContract = RegisteredCliJsonResultContract;

/** Every command path covered by the public CLI JSON result registry. */
export type CliJsonResultCommand = CliResultContract["commands"][number];

/** Select the registry member that owns one command path. */
type ContractForCommand<
  Command extends CliJsonResultCommand,
  Contract = CliResultContract,
> = Contract extends CliResultContract
  ? Command extends Contract["commands"][number] ? Contract : never
  : never;

/** Infer the validated output of the schema registered for one command path. */
export type CliResultForCommand<Command extends CliJsonResultCommand> =
  z.output<
    ContractForCommand<Command>["schema"]
  >;

/** Infer the union returned when a caller discovers the command at runtime. */
export type CliResultEnvelope<Contract = CliResultContract> = Contract extends
  CliResultContract ? z.output<Contract["schema"]> : never;

/** Keep union members that declare one key, making that key present. */
type UnionMemberWithKey<Union, Key extends PropertyKey> = Union extends unknown
  ? Key extends keyof Union ? Union & Record<Key, Union[Key]> : never
  : never;

/**
 * Prove that a decoded result carries the verb-specific data alternative named
 * by one required key, excluding the shared config-issue payload at runtime.
 */
export function assertResultDataKey<
  Result extends { data?: object | undefined },
  Key extends PropertyKey,
>(
  result: Result,
  key: Key,
): asserts result is Result & {
  data: UnionMemberWithKey<NonNullable<Result["data"]>, Key>;
} {
  if (result.data === undefined || !(key in result.data)) {
    throw new Error(
      `Decoded result data does not carry required key ${String(key)}`,
    );
  }
}

/** Keep failure diagnostics useful without copying arbitrarily large output. */
function boundedExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_CHARS) return text;
  return `${text.slice(0, EXCERPT_MAX_CHARS)}…`;
}

/** Name one captured stream in a failure message, bounded. */
function excerptLine(label: string, text: string): string {
  return `${label} excerpt: ${JSON.stringify(boundedExcerpt(text))}`;
}

/** The process evidence a failed command-result decode reports. */
function runEvidence(run: CliRun): string[] {
  return [
    `exit code: ${run.code}`,
    excerptLine("stdout", run.stdout),
    excerptLine("stderr", run.stderr),
  ];
}

/** Normalize an unknown thrown value for a synthetic parse issue. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the one bounded error shape shared by both public decoders. */
function decodeError(
  context: string,
  issues: unknown,
  evidence: readonly string[],
  cause?: unknown,
): Error {
  const message = [
    context,
    `Zod issues: ${JSON.stringify(issues, null, 2)}`,
    ...evidence,
  ].join("\n");
  return cause === undefined
    ? new Error(message)
    : new Error(message, { cause });
}

/** Parse JSON text and preserve a concrete schema's inferred output type. */
function decodeJson<T>(
  schema: z.ZodType<T>,
  text: string,
  context: string,
  evidence: readonly string[],
): T;

/** Parse through a runtime-selected schema whose output is known only to its caller. */
function decodeJson(
  schema: z.ZodType,
  text: string,
  context: string,
  evidence: readonly string[],
): unknown;

/** Cross the shared JSON and Zod boundary used by both public decoders. */
function decodeJson(
  schema: z.ZodType,
  text: string,
  context: string,
  evidence: readonly string[],
): unknown {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw decodeError(
      context,
      [{
        code: "custom",
        path: [],
        message: `invalid JSON: ${errorMessage(error)}`,
      }],
      evidence,
      error,
    );
  }
  const decoded = schema.safeParse(raw);
  if (!decoded.success) {
    throw decodeError(context, decoded.error.issues, evidence, decoded.error);
  }
  return decoded.data;
}

/**
 * Decode non-envelope JSON with a caller-supplied schema, inferring its output
 * type from that schema.
 */
export function decodeWith<T>(schema: z.ZodType<T>, text: string): T {
  return decodeJson(schema, text, "Could not decode JSON text", [
    excerptLine("text", text),
  ]);
}

/**
 * Decode a command run's JSON stdout through the schema registered for that
 * exact command path. Literal commands infer their contract-specific envelope
 * type.
 */
export function decodeCliResult<Command extends CliJsonResultCommand>(
  run: CliRun,
  command: Command,
): CliResultForCommand<Command>;

/** Decode a runtime command path, returning the registry's envelope union. */
export function decodeCliResult(
  run: CliRun,
  command: string,
): CliResultEnvelope;

/** Resolve the runtime registry member before crossing the Zod boundary. */
export function decodeCliResult(
  run: CliRun,
  command: string,
): unknown {
  return decodeRegistered(
    command,
    run.stdout,
    `Could not decode --json stdout for command ${JSON.stringify(command)}`,
    runEvidence(run),
  );
}

/**
 * Decode result JSON that no captured process printed, such as an in-process
 * serialization or an MCP tool's structured content. A process run decodes
 * through {@link decodeCliResult}, so its failure reports its exit code and
 * stderr.
 */
export function decodeResultText<Command extends CliJsonResultCommand>(
  text: string,
  command: Command,
): CliResultForCommand<Command>;

/** Decode runtime-selected result text, returning the registry's envelope union. */
export function decodeResultText(
  text: string,
  command: string,
): CliResultEnvelope;

/** Resolve the runtime registry member before crossing the Zod boundary. */
export function decodeResultText(text: string, command: string): unknown {
  return decodeRegistered(
    command,
    text,
    `Could not decode result text for command ${JSON.stringify(command)}`,
    [excerptLine("text", text)],
  );
}

/** Decode through the contract registered for one command path. */
function decodeRegistered(
  command: string,
  text: string,
  context: string,
  evidence: readonly string[],
): unknown {
  const contract = CLI_JSON_RESULT_CONTRACTS.find((candidate) =>
    candidate.commands.includes(command)
  );
  if (contract === undefined) {
    throw decodeError(
      context,
      [{
        code: "custom",
        path: [],
        message: "no registered CLI JSON result contract",
      }],
      evidence,
    );
  }
  return decodeJson(contract.schema, text, context, evidence);
}
