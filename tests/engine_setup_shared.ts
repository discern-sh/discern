/**
 * Shared fixtures for the setup suites (`engine_setup_test.ts`,
 * `engine_setup_done_test.ts`) — a non-test module, because importing one
 * _test.ts from another would re-register its tests under the importer's
 * runner.
 */

/** The setup brief's H1 — the marker that the instructions were served. */
export const INSTRUCTIONS_H1 = "# Set up discern";
