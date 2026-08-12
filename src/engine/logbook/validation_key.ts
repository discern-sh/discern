/** Repository-common secret that makes validation evidence opaque. */

import { dirname } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import type { ValidationIncomplete } from "./validation.ts";

/** Resolve, validate, or atomically mint the registered 32-byte HMAC key. */
export async function validationKey(root: string): Promise<
  | { key: Uint8Array }
  | { incomplete: ValidationIncomplete }
> {
  const path = await gitAdminStatePath(root, "validationHmacKey");
  if (path === undefined) {
    return { incomplete: { category: "key", reason: "unavailable" } };
  }
  try {
    const existing = await Deno.readFile(path);
    return existing.length === 32
      ? { key: existing }
      : { incomplete: { category: "key", reason: "invalid" } };
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      return { incomplete: { category: "key", reason: "unreadable" } };
    }
  }
  try {
    await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const created = crypto.getRandomValues(new Uint8Array(32));
    const file = await Deno.open(path, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
    try {
      let offset = 0;
      while (offset < created.length) {
        offset += await file.write(created.subarray(offset));
      }
    } finally {
      file.close();
    }
    return { key: created };
  } catch (error) {
    // A concurrent validation may have won the createNew race.
    if (error instanceof Deno.errors.AlreadyExists) {
      try {
        const raced = await Deno.readFile(path);
        return raced.length === 32
          ? { key: raced }
          : { incomplete: { category: "key", reason: "invalid" } };
      } catch {
        // Fall through to the fail-open evidence below.
      }
    }
    return { incomplete: { category: "key", reason: "unreadable" } };
  }
}
