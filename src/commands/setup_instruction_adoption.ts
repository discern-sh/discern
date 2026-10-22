/**
 * Setup's adoption of existing agent files into the instruction source, before
 * the first compile. Each existing file is the owner's, which setup folds into
 * the source, or another tool's, which the coding agent names with
 * `--tool-maintained` and setup leaves out (ADR 0065, ADR 0429).
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import type { SetupConfig } from "../lib/config.ts";
import { rebaseMarkdownLinks } from "../lib/markdown_links.ts";
import { resolveSetupDir } from "../lib/paths.ts";
import {
  allInstructionFilePaths,
  allInstructionFiles,
  instructionPointerLines,
} from "../lib/providers.ts";
import {
  agentFileOwnershipPatterns,
  type InstructionOwnershipPattern,
  matchesInstructionOwnership,
} from "../engine/instruction_render.ts";
import { loadConfig } from "../shared/config_schema.ts";
import { readTextIfExists } from "../shared/fs_presence.ts";

/**
 * Seed the instruction source at `instructionRel` (the resolved `[instructions].sources`
 * seed location) before the first compile, and — critically — migrate any
 * pre-existing, hand-authored agent file into it so the compile that follows
 * can't destroy the user's instructions (ADR 0065).
 *
 * The migration walks EVERY provider's instruction-file path
 * ({@link allInstructionFilePaths}) — the same registry aggregator `setup verify`
 * names the pre-existing files from — never just the configured agent set. The
 * scaffolded `.gitignore` covers the full provider surface and `uninstall`
 * deletes every provider instruction path, so a hand-authored file for an unwired
 * agent that was not folded here would silently fall out of version control and
 * later be deleted — the exact loss `verify`'s "nothing is lost" promise rules
 * out.
 *
 * On a FRESH install no discern-agent file SHOULD exist (discern writes
 * them only via a compile, which needs a config) — but one can survive an
 * abandoned earlier setup: an uncommitted compiled file outlives a branch switch
 * or a deleted `discern-setup` branch. So a candidate is treated
 * as the USER's — its body folded into the source under a labelled heading,
 * deduped by content so identical mirrors migrate once — only when it does NOT
 * match an ownership pattern discern's own render produces
 * ({@link agentFileOwnershipPatterns} over the full registry is deterministic
 * from config + sources). Pointer bodies match exactly; a full body may vary only
 * at the map-region slot because that derived list can outlive its map. A match is
 * skipped and reported, never re-imported as if it were authoring. The stub is
 * laid only when the source is absent, so a re-run never clobbers the agent's
 * work; on a `--reseed` run the user's content is already in the source from
 * the first run, so migration is skipped.
 *
 * A file the coding agent named in `toolMaintained` holds another tool's
 * content, not the owner's: importing it would freeze a snapshot the tool keeps
 * rewriting, so it is left out and reported instead. An imported body drops
 * provider pointer lines, such as an import of `AGENTS.md`: the compile writes
 * its own pointers, and the source would otherwise make the canonical file
 * import itself.
 */
export async function seedInstructions(
  root: string,
  instructionRel: string,
  config: SetupConfig,
  freshInstall: boolean,
  toolMaintained: ReadonlySet<string>,
): Promise<{
  instructionLaid: boolean;
  migrated: string[];
  skippedOwnRender: string[];
  leftToTool: string[];
}> {
  const instructionPath = join(root, instructionRel);

  // Capture pre-existing user agent files (fresh install only — see above).
  const migrated: { file: string; body: string }[] = [];
  const skippedOwnRender: string[] = [];
  const leftToTool: string[] = [];
  if (freshInstall) {
    // Every body discern's own compile could have produced for ANY provider's
    // agent file — the full body and the pointer form — rendered from the
    // just-scaffolded config + the on-disk sources across the whole registry,
    // so a survivor of an abandoned setup is recognized whichever agents that
    // run had wired. Unavailable (undefined) when the config can't load; the
    // migration then proceeds as before rather than blocking the scaffold.
    let ownRenderPatterns: InstructionOwnershipPattern[] | undefined;
    try {
      const cfg = await loadConfig(root);
      ownRenderPatterns = await agentFileOwnershipPatterns(
        root,
        cfg,
        allInstructionFiles(),
      );
    } catch {
      // discern-best-effort: setup-agent-file-ownership-fallback
      ownRenderPatterns = undefined;
    }
    const seen = new Set<string>();
    const pointerLines = instructionPointerLines();
    for (const rel of allInstructionFilePaths()) {
      const existing = await readTextIfExists(join(root, rel));
      if (existing === undefined) continue;
      const body = existing.trim();
      if (body.length === 0) continue;
      if (
        ownRenderPatterns?.some((pattern) =>
          matchesInstructionOwnership(pattern, body)
        )
      ) {
        // A survivor of an abandoned setup, not the user's authoring — importing
        // it would fold discern's own compiled instructions back into the source.
        skippedOwnRender.push(rel);
        continue;
      }
      if (toolMaintained.has(rel)) {
        leftToTool.push(rel);
        continue;
      }
      const ownerBody = body.split("\n")
        .filter((line) => !pointerLines.has(line.trim()))
        .join("\n").trim();
      if (ownerBody.length === 0) continue;
      // The content moves from the provider file into the configured authored
      // source before compilation moves it back out. Rebase only real Markdown
      // destinations at each move so adoption cannot change what a local link
      // points at merely because the source lives in another directory.
      const authoredBody = rebaseMarkdownLinks(ownerBody, rel, instructionRel);
      if (seen.has(authoredBody)) continue;
      seen.add(authoredBody);
      migrated.push({ file: rel, body: authoredBody });
    }
  }

  // Lay the stub when the source is absent (write-once: a re-run keeps the agent's).
  let content: string;
  let instructionLaid = false;
  try {
    content = await Deno.readTextFile(instructionPath);
  } catch {
    const stub = join(await resolveSetupDir(), "skeleton", "instructions.md");
    content = (await Deno.readTextFile(stub)).replaceAll(
      "{{project_name}}",
      config.projectName,
    );
    instructionLaid = true;
  }

  // Append each migrated body under a labelled heading, skipping any already present
  // (idempotent if setup is re-run).
  let appended = "";
  for (const m of migrated) {
    const heading = `## Imported from ${m.file}`;
    if (content.includes(heading) || content.includes(m.body)) {
      continue;
    }
    appended += `\n${heading}\n\n` +
      `<!-- discern imported your existing ${m.file} here during setup so it wouldn't ` +
      `be lost. Fold it into the conventions above, then delete this note. -->\n\n` +
      `${m.body}\n`;
  }

  if (instructionLaid || appended.length > 0) {
    await ensureDir(dirname(instructionPath));
    await Deno.writeTextFile(instructionPath, content + appended);
  }
  return {
    instructionLaid,
    migrated: migrated.map((m) => m.file),
    skippedOwnRender,
    leftToTool,
  };
}
