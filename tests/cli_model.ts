/**
 * Test-owned projection of the fully attached CLI command tree. Runtime code
 * receives the same provider from the binary entry point, while in-process
 * Gate tests build it explicitly so no library module imports `src/main.ts`.
 */

import { buildCli } from "../src/main.ts";
import {
  type CliCommand,
  cliCommandModel,
  type CliModelProvider,
} from "../src/shared/cli_reference_codegen.ts";

/** Live CLI model provider for in-process Gate and lifecycle tests. */
export const TEST_CLI_MODEL: CliModelProvider = (): CliCommand =>
  cliCommandModel(buildCli(false));
