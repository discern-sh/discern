/**
 * Every shipped consumer of the skill-directory registry, and what it does
 * with the path (ADR 0424).
 *
 * A provider skills directory is shared with any other tool that installs
 * skills there, so discern owns only the entries its materialization record
 * names. Whole-directory ownership — an ignore rule for the directory, a
 * recursive delete, a check that flags everything beneath it — always begins
 * with code that reads a directory path from the provider registry. The guard
 * (`tests/skill_dir_consumers_guard_test.ts`) therefore enrolls every such read
 * by call site: a new consumer fails the gate until it is declared here with a
 * posture, and only the ownership module may decide what discern owns inside a
 * directory. Every shipped importer of that module is enrolled too, with the
 * behavioural test proving it leaves foreign entries alone.
 */

/** What a consumer does with a skills-directory path. */
export type SkillDirPosture =
  | "ownership"
  | "materialization"
  | "retirement"
  | "classification"
  | "presentation"
  | "observation"
  | "registry";

/** The meaning of each posture — the contract a declaration asserts. */
export const SKILL_DIR_POSTURES: Readonly<Record<SkillDirPosture, string>> = {
  ownership:
    "Decides which entries inside a directory discern owns, from the ownership record. Only the ownership module may hold this posture.",
  materialization:
    "Hands directories to the materialization planner, which applies the ownership record to every entry it touches.",
  retirement:
    "Recognizes directory-wide rules earlier versions wrote, so upgrade can remove them.",
  classification:
    "Classifies changes under a directory for landing scopes; claims nothing on disk.",
  presentation: "Shows or groups the path for a reader; changes nothing.",
  observation: "Reads the directory's state; changes nothing.",
  registry:
    "Derives or declares the path inside the provider registry or the ownership inventory.",
};

/** The registry accessors whose every shipped use must be declared below. */
export const SKILL_DIR_ACCESSORS: readonly string[] = [
  "skillsDir",
  "skillsDirsForAgents",
  "allSkillsDirs",
  "claudeSkillsDirOf",
  "neutralAgentScopePaths",
  "agentIntegrationPrefixes",
  "materializedDirs",
  "generatedSkillsDir",
];

/** One declared consumer: its posture and why that posture holds. */
export interface SkillDirConsumer {
  readonly posture: SkillDirPosture;
  readonly why: string;
}

/** Every shipped call site that reads a skills-directory path from the registry,
 * keyed `<module>#<enclosing function>`. */
export const SKILL_DIR_CONSUMERS: Readonly<Record<string, SkillDirConsumer>> = {
  "src/commands/doctor.ts#runChecks": {
    posture: "presentation",
    why:
      "Lists each configured agent's skills directory among the integration surfaces discern wires.",
  },
  "src/engine/dispatch.ts#planSkillsEject": {
    posture: "materialization",
    why:
      "Re-plans materialization for the configured directories after an eject.",
  },
  "src/engine/instruction_render.ts#instructionContext": {
    posture: "presentation",
    why: "Renders the configured directories into the compiled instructions.",
  },
  "src/engine/instructions.ts#materializeLocalRefreshArtifacts": {
    posture: "materialization",
    why:
      "Materializes the effective skill set into the configured directories.",
  },
  "src/engine/status/fleet_fingerprint.ts#fleetFingerprintLayout": {
    posture: "observation",
    why: "Fingerprints the directories so status can skip an unchanged survey.",
  },
  "src/engine/tracked_refresh.ts#planRefresh": {
    posture: "materialization",
    why: "Plans materialization as part of the complete refresh plan.",
  },
  "src/lib/agent_gitignore.ts#discernOwnedArtifactIgnorePaths": {
    posture: "retirement",
    why:
      "Recognizes the directory rules earlier managed .gitignore blocks carried, so upgrade removes them.",
  },
  "src/lib/artifact_ownership.ts#providerArtifacts": {
    posture: "registry",
    why:
      "Declares each directory Shared in the ownership inventory, with discern's control files declared on their own.",
  },
  "src/lib/config.ts#defaultInstructionScopePaths": {
    posture: "classification",
    why:
      "Seeds the directories into the instructions landing scope, so skill changes get owner review.",
  },
  "src/lib/detect_agents.ts#consentAgentSet": {
    posture: "presentation",
    why: "Carries each selected agent's directory into setup's consent facts.",
  },
  "src/lib/plan_view.ts#renderReview": {
    posture: "presentation",
    why: "Groups setup's integration review by top-level provider directory.",
  },
  "src/lib/providers.ts#agentArtifactPosture": {
    posture: "registry",
    why: "Derives the per-kind artifact posture from the provider registry.",
  },
  "src/lib/providers.ts#agentIntegrationPrefixes": {
    posture: "registry",
    why: "Derives the top-level provider prefixes setup groups by.",
  },
  "src/lib/providers.ts#allSkillsDirs": {
    posture: "registry",
    why: "Derives every known agent's directory.",
  },
  "src/lib/providers.ts#neutralAgentScopePaths": {
    posture: "registry",
    why: "Derives the directory prefixes the instructions scope seeds.",
  },
  "src/lib/providers.ts#providerSetupFacts": {
    posture: "registry",
    why: "Projects one provider's directory into setup facts.",
  },
  "src/lib/providers.ts#skillsDirsForAgents": {
    posture: "registry",
    why: "Derives the configured agents' directories.",
  },
  "src/lib/providers.ts#writtenProviderArtifactPathsForAgents": {
    posture: "registry",
    why:
      "Lists the directories among the paths discern writes into for the setup write plan.",
  },
  "src/lib/skill_ownership.ts#surveySkillsDirs": {
    posture: "ownership",
    why:
      "Classifies every entry of every known directory against the ownership record.",
  },
  "src/lib/skills.ts#checkSkillsCurrent": {
    posture: "materialization",
    why:
      "Projects the materialization plan for each configured directory as read-only drift.",
  },
  "src/lib/skills.ts#claudeSkillsDirOf": {
    posture: "registry",
    why: "Resolves one provider's directory path for callers that report it.",
  },
  "src/shared/setup_messages.ts#consentRelayItems": {
    posture: "presentation",
    why: "Names the selected directories in setup's consent relay.",
  },
};

/** How a shipped importer uses the ownership module. */
export type OwnershipImport =
  | {
    /** Imports only the module's named constants (file names). */
    readonly role: "names";
    readonly why: string;
  }
  | {
    /** Acts on ownership answers; a behavioural test proves foreign entries
     * survive it. */
    readonly role: "decides";
    readonly proof: { readonly file: string; readonly test: string };
  };

/** The ownership module whose importers are enrolled below. */
export const SKILL_OWNERSHIP_MODULE = "src/lib/skill_ownership.ts";

/** Every shipped module that imports the ownership module. */
export const SKILL_OWNERSHIP_IMPORTERS: Readonly<
  Record<string, OwnershipImport>
> = {
  "src/commands/doctor.ts": {
    role: "decides",
    proof: {
      file: "tests/doctor_test.ts",
      test:
        "doctor: skills directories warn when Git's ignore rules disagree with entry ownership",
    },
  },
  "src/commands/uninstall.ts": {
    role: "decides",
    proof: {
      file: "tests/engine_uninstall_test.ts",
      test:
        "uninstall removes discern's skill entries and keeps every entry it did not place",
    },
  },
  "src/lib/agent_gitignore.ts": {
    role: "decides",
    proof: {
      file: "tests/agent_gitignore_test.ts",
      test:
        "trackedDiscernIgnoredArtifacts flags forced owned/local paths — never a user's, another tool's, or an instruction file",
    },
  },
  "src/lib/artifact_ownership.ts": {
    role: "names",
    why: "Declares discern's control files in the ownership inventory.",
  },
  "src/lib/skills.ts": {
    role: "decides",
    proof: {
      file: "tests/skill_ownership_test.ts",
      test:
        "materialization leaves another tool's skill untouched, visible to Git, and ignores only its own entries",
    },
  },
};
