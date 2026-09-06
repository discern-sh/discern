/** Read the exact committed source and composition procedure before a desk decision. */
import { loadConfig } from "../../shared/config_schema.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { compositionRecipe } from "../landing_queue/generation.ts";
import { gitValue, observeSource } from "../landing_queue/composition.ts";
import { resolveIdentity } from "./identity.ts";
import {
  type EffortGrantSubject,
  EffortGrantSubjectSchema,
} from "./effort_grant.ts";

/** Dirty, detached or changed source cannot become an approval of an unreviewed descendant. */
export async function inspectEffortGrantSubject(
  root: string,
  branch: string,
): Promise<EffortGrantSubject> {
  const before = await pinValidatedTree(root);
  if (
    !before.clean || before.head === undefined ||
    await gitValue(root, ["symbolic-ref", "--quiet", "HEAD"]) !==
      `refs/heads/${branch}`
  ) {
    throw new Error(
      "Commit the source and select its named branch before recording a landing grant.",
    );
  }
  const config = await loadConfig(root);
  const identity = await resolveIdentity(root, root);
  const source = await observeSource(root, identity.id, `refs/heads/${branch}`);
  const recipe = await compositionRecipe(
    root,
    config,
    DISCERN_VERSION,
    Math.max(1, config.gate.timeout),
    {},
  );
  const after = await pinValidatedTree(root);
  if (
    !after.clean || before.head !== after.head || source.head !== after.head
  ) {
    throw new Error(
      "Source changed while preparing the grant. Review the current committed source again.",
    );
  }
  return EffortGrantSubjectSchema.parse({
    source,
    composition_procedure: recipe.identity.procedure,
  });
}
