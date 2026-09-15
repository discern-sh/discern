/** Project adoption provenance and SemVer precedence (ADR 0400). */
import { compareVersions } from "./semver.ts";
import { DISCERN_VERSION } from "../lib/version.ts";
import {
  discernCommand,
  flag,
  renderCommandRefsCli,
} from "./command_reference.ts";

/** An older engine cannot render or replace newer version-specific material. */
export function managedMaterialBoundary(
  config: { readonly meta: { readonly managed_version?: string | undefined } },
  running = DISCERN_VERSION,
): string | undefined {
  const comparison = compareManagedVersion(
    running,
    config.meta.managed_version,
  );
  return comparison.state === "project-managed-by-newer"
    ? managedVersionAdvice(comparison)
    : undefined;
}

export class ManagedMaterialError extends Error {}

/** Refuse before planning or applying an older bundle. */
export function assertManagedMaterialWritable(
  config: { readonly meta: { readonly managed_version?: string | undefined } },
): void {
  const message = managedMaterialBoundary(config);
  if (message !== undefined) throw new ManagedMaterialError(message);
}

export const MANAGED_VERSION_STATES = [
  "unknown",
  "equal",
  "running-newer",
  "project-managed-by-newer",
] as const;

export interface ManagedVersionComparison {
  readonly state: (typeof MANAGED_VERSION_STATES)[number];
  readonly running: string;
  readonly managed?: string | undefined;
}

/** Compare adoption evidence, independently of schema and managed bytes. */
export function compareManagedVersion(
  running: string,
  managed?: string,
): ManagedVersionComparison {
  if (managed === undefined) return { state: "unknown", running };
  const order = compareVersions(running, managed);
  return {
    running,
    managed,
    state: order === 0
      ? "equal"
      : order > 0
      ? "running-newer"
      : "project-managed-by-newer",
  };
}

export interface ManagedVersionAdoption {
  readonly previous: string | null;
  readonly adopted: string;
}

/** Plan a monotonic stamp; equal precedence preserves original build metadata. */
export function planManagedVersionAdoption(
  running: string,
  managed?: string,
): ManagedVersionAdoption {
  return {
    previous: managed ?? null,
    adopted: managed === undefined || compareVersions(running, managed) > 0
      ? running
      : managed,
  };
}

/** One local explanation; only the external release page knows public latest. */
export function managedVersionAdvice(
  comparison: ManagedVersionComparison,
  format: "cli" | "references" = "cli",
): string | undefined {
  const text = managedVersionAdviceTemplate(comparison);
  return text === undefined || format === "references"
    ? text
    : renderCommandRefsCli(text);
}

/** Keep actionable command references intact until the delivery surface renders. */
function managedVersionAdviceTemplate(
  comparison: ManagedVersionComparison,
): string | undefined {
  switch (comparison.state) {
    case "equal":
      return undefined;
    case "unknown":
      return `This project has no recorded managed-version adoption. Run ${
        discernCommand("upgrade", flag("dry-run"))
      } to preview adoption; a successful ${
        discernCommand("upgrade")
      } records it.`;
    case "running-newer":
      return `This project last adopted discern ${comparison.managed}; this binary is ${comparison.running}. Run ${
        discernCommand("upgrade", flag("dry-run"))
      }, then ${discernCommand("upgrade")} to adopt its managed material.`;
    case "project-managed-by-newer":
      return `This project was last upgraded with discern ${comparison.managed}; this binary is ${comparison.running}. Check releases before changing discern-managed files: run ${
        discernCommand("releases")
      }. After installing a suitable update, restart your coding-agent sessions. Development builds may be ahead of the latest public release.`;
  }
}

/** Trunk adoption cannot be deleted or moved backward, even by a clean revert. */
export function managedVersionRegression(
  trunk: string | undefined,
  proposed: string | undefined,
): string | undefined {
  if (
    trunk === undefined ||
    (proposed !== undefined && compareVersions(proposed, trunk) >= 0)
  ) return undefined;
  return `The shared branch records managed_version ${trunk}; this branch ${
    proposed === undefined ? "deletes it" : `lowers it to ${proposed}`
  }. Restore the trunk value or run a newer successful \`discern upgrade\`. Rolling back managed material must retain the highest adopted version.`;
}
