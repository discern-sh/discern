/**
 * Contract-validating JSON decoders for test fixtures and discern CLI stdout.
 *
 * Command results resolve their Zod schema through the public result-contract
 * registry, so a test cannot silently consume a shape the command no longer
 * promises. Non-envelope JSON crosses the same parse-and-validate boundary via
 * {@link decodeWith}.
 */

import type { z } from "@zod/zod";
import {
  CLI_JSON_RESULT_CONTRACTS,
  type RegisteredCliJsonResultContract,
} from "../src/shared/result_contracts.ts";

const STDOUT_EXCERPT_MAX_CHARS = 400;

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

/** Keep failure diagnostics useful without copying arbitrarily large stdout. */
function boundedExcerpt(text: string): string {
  if (text.length <= STDOUT_EXCERPT_MAX_CHARS) return text;
  return `${text.slice(0, STDOUT_EXCERPT_MAX_CHARS)}…`;
}

/** Normalize an unknown thrown value for a synthetic parse issue. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the one bounded error shape shared by both public decoders. */
function decodeError(
  context: string,
  issues: unknown,
  text: string,
  cause?: unknown,
): Error {
  const message = [
    context,
    `Zod issues: ${JSON.stringify(issues, null, 2)}`,
    `stdout excerpt: ${JSON.stringify(boundedExcerpt(text))}`,
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
): T;

/** Parse through a runtime-selected schema whose output is known only to its caller. */
function decodeJson(
  schema: z.ZodType,
  text: string,
  context: string,
): unknown;

/** Cross the shared JSON and Zod boundary used by both public decoders. */
function decodeJson(
  schema: z.ZodType,
  text: string,
  context: string,
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
      text,
      error,
    );
  }
  const decoded = schema.safeParse(raw);
  if (!decoded.success) {
    throw decodeError(context, decoded.error.issues, text, decoded.error);
  }
  return decoded.data;
}

/**
 * Decode non-envelope JSON with a caller-supplied schema, inferring its output
 * type from that schema.
 */
export function decodeWith<T>(schema: z.ZodType<T>, text: string): T {
  return decodeJson(schema, text, "Could not decode JSON text");
}

/**
 * Decode a command's JSON stdout through the schema registered for that exact
 * command path. Literal commands infer their contract-specific envelope type.
 */
export function decodeCliResult<Command extends CliJsonResultCommand>(
  stdout: string,
  command: Command,
): CliResultForCommand<Command>;

/** Decode a runtime command path, returning the registry's envelope union. */
export function decodeCliResult(
  stdout: string,
  command: string,
): CliResultEnvelope;

/** Resolve the runtime registry member before crossing the Zod boundary. */
export function decodeCliResult(
  stdout: string,
  command: string,
): unknown {
  const contract = CLI_JSON_RESULT_CONTRACTS.find((candidate) =>
    candidate.commands.includes(command)
  );
  const context = `Could not decode --json stdout for command ${
    JSON.stringify(command)
  }`;
  if (contract === undefined) {
    throw decodeError(
      context,
      [{
        code: "custom",
        path: [],
        message: "no registered CLI JSON result contract",
      }],
      stdout,
    );
  }
  return decodeJson(contract.schema, stdout, context);
}
