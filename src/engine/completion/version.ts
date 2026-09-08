/** Version compatibility shared by record storage and read-only identity projections. */
import {
  ON_DISK_FORMATS,
  type OnDiskVersionInspection,
} from "../../shared/on_disk_formats.ts";

/** Accept only the current envelope or an explicitly supported older shape. */
export function completionRecordVersionSupported(
  version: OnDiskVersionInspection,
): boolean {
  return version.status === "current" ||
    (version.status === "older" &&
      ON_DISK_FORMATS.completionRecord.historicalVersions.some((v) =>
        v === version.found
      ));
}
