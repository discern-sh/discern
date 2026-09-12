// Generated from the result contract registry. Regenerate rather than edit.

export type DiscernKnownErrorSlug =
  | "active_worktrees"
  | "ambiguous"
  | "apply_failed"
  | "awaiting_consent"
  | "awaiting_declaration"
  | "awaiting_standard_approval"
  | "awaiting_variance"
  | "below_min_score"
  | "brief_unparseable"
  | "checkout_failed"
  | "checkpoint_evidence_unavailable"
  | "config_template_unavailable"
  | "confirmation_required"
  | "conflict"
  | "desk_already_active"
  | "detached_head"
  | "diagrams_misaligned"
  | "dirty_worktree"
  | "edit_error"
  | "gate_failed"
  | "gitignore_template_unavailable"
  | "identity_error"
  | "incomplete"
  | "internal_error"
  | "invalid_arguments"
  | "invalid_config"
  | "invalid_config_file"
  | "invalid_migrated_config"
  | "invalid_settings_file"
  | "invalid_toml"
  | "invalid_value"
  | "no_docs"
  | "no_map"
  | "no_repository"
  | "no_such_step"
  | "no_target"
  | "not_found"
  | "not_initialized"
  | "not_main_checkout"
  | "not_on_setup_branch"
  | "not_on_trunk"
  | "not_set_up"
  | "partial_acceptance"
  | "partial_materialization"
  | "partial_refresh"
  | "pin_failed"
  | "precondition_failed"
  | "proposal_failed"
  | "proposal_stale"
  | "provisioned_resources"
  | "read_error"
  | "renamed_command"
  | "renamed_config_key"
  | "report_only_proof"
  | "schema_version_too_new"
  | "script_not_a_command"
  | "script_not_executable"
  | "setup_plan_failed"
  | "skills_eject_failed"
  | "tables_malformed"
  | "templates_not_found"
  | "tidy_parse_failed"
  | "tidy_write_failed"
  | "unchanged_tree_rerun"
  | "unknown_category"
  | "unknown_command"
  | "unknown_key"
  | "unknown_standard"
  | "write_access";

export type DiscernResultState =
  & ({
    ok: true;
    error?: never;
    [key: string]: unknown;
  } | {
    ok: false;
    error?: string;
    [key: string]: unknown;
  })
  & ({
    dry_run: true;
    plan?: {
      title: string;
      details: Array<string>;
      steps: Array<{
        kind:
          | "job"
          | "scope-gate"
          | "merge-check"
          | "standards-limits-check"
          | "tracked-artifacts-check"
          | "instructions-check"
          | "skills-check"
          | "tracked-refresh-check"
          | "resource-create"
          | "resource-destroy"
          | "git"
          | "task-metadata"
          | "setup-step"
          | "repository-ensure"
          | "checkout-clean-check"
          | "setup-ensure"
          | "env"
          | "refresh"
          | "tidy"
          | "standard";
        label: string;
        disposition: "run" | "skip" | "gate";
        note?: string;
        group?: string;
      }>;
    };
    steps?: never;
    [key: string]: unknown;
  } | {
    dry_run?: false;
    plan: {
      title: string;
      details: Array<string>;
      steps: Array<{
        kind:
          | "job"
          | "scope-gate"
          | "merge-check"
          | "standards-limits-check"
          | "tracked-artifacts-check"
          | "instructions-check"
          | "skills-check"
          | "tracked-refresh-check"
          | "resource-create"
          | "resource-destroy"
          | "git"
          | "task-metadata"
          | "setup-step"
          | "repository-ensure"
          | "checkout-clean-check"
          | "setup-ensure"
          | "env"
          | "refresh"
          | "tidy"
          | "standard";
        label: string;
        disposition: "run" | "skip" | "gate";
        note?: string;
        group?: string;
      }>;
    };
    steps?: never;
    [key: string]: unknown;
  } | {
    dry_run?: false;
    plan?: never;
    steps?: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
      outcome: "ok" | "failed" | "skipped" | "cancelled";
      advisory?: {
        kind:
          | "acceptance-cleanup-incomplete"
          | "checkpoint-evidence-dropped"
          | "checkout-clean-observation-unavailable"
          | "doctor-warning"
          | "execution-cap-unavailable"
          | "generated-attribute-pattern-untranslated"
          | "ignored-file-observation-unavailable"
          | "landing-authority-unverified"
          | "optional-resource-unavailable"
          | "proof-recording-unavailable"
          | "setup-unproven-completion"
          | "setup-machinery-commit-failed"
          | "setup-marker-commit-failed"
          | "standards-limits-unverified"
          | "uninstall-strip-incomplete";
        evidence: Array<string>;
        next_action: string;
      };
      duration_s?: number;
      output_path?: string;
      output_lines?: number;
      error_like_lines?: number;
    }>;
    [key: string]: unknown;
  });

export type DiscernProofSummary = {
  completion?: {
    candidate_id: string;
    proof_id: string;
  };
  branch: string;
  trunk: string;
  head: string;
  files_total: number;
  insertions: number;
  deletions: number;
  line: string;
  mode?: "strict" | "report";
  checkpoint_drops?: Array<
    {
      scope: "policy";
      checkpoint: null;
      mode: null;
      policy_commit?: string;
      reason:
        | "merge_base_unresolved"
        | "governing_config_unreadable"
        | "governing_config_invalid"
        | "open_question_store_unreadable"
        | "open_question_store_corrupt"
        | "declaration_evidence_unavailable"
        | "strand_check_unavailable";
      account: string;
    } | {
      scope: "checkpoint";
      checkpoint: string;
      mode: "stop" | "advise";
      policy_commit: string;
      reason:
        | "checkpoint_missing_question"
        | "checkpoint_question_file_missing"
        | "checkpoint_question_file_invalid_path"
        | "checkpoint_question_file_not_regular"
        | "checkpoint_question_file_oversized"
        | "checkpoint_question_file_invalid_utf8"
        | "checkpoint_question_file_unreadable"
        | "checkpoint_question_source_conflict"
        | "checkpoint_selector_conflict"
        | "checkpoint_unknown_scope"
        | "effort_diff_unreadable"
        | "trigger_content_unavailable"
        | "trigger_history_unavailable"
        | "when_spawn_failed"
        | "when_timeout"
        | "when_invalid_exit"
        | "when_cancelled"
        | "when_input_failed"
        | "when_input_cleanup_failed"
        | "when_output_limit"
        | "open_question_store_rebuilt"
        | "subject_unavailable"
        | "open_question_store_write_failed";
      account: string;
    }
  >;
  standard_proposals?: Array<{
    standard: string;
    commit: string;
    bound_commit: string;
    measured_commit: string;
    definition_fingerprint: string;
    trunk: string;
    trunk_commit: string;
    direction: "up" | "down";
    trunk_limit: number;
    proposed_limit: number;
    measurement: number;
    delta: number;
    reason: string;
    evidence_paths: Array<string>;
  }>;
};

export type __schema0 = {
  path: Array<string>;
  description: string;
  aliases: Array<string>;
  hidden: boolean;
  args: Array<{
    name: string;
    optional: boolean;
    variadic: boolean;
  }>;
  usage: string;
  options: Array<{
    flags: Array<string>;
    description: string;
    type_definition: string;
    arity: number;
    value_types: Array<string>;
    default_value: unknown;
    hidden: boolean;
    global: boolean;
  }>;
  children: Array<__schema0>;
};

export type DiscernSubmissionRow = {
  effort: string;
  branch: string;
  path: string;
  head: string;
  submitted_at: string;
  authority: "pre-authorized" | "awaiting-owner";
  authority_source?: "effort-grant" | "standing-grant";
  granted_at?: string;
  position: number;
  readiness: "ready" | "waiting";
  reason?: string;
};

export type DiscernAuthorizedVariance = {
  checkpoint: string;
  definition_hash: string;
  subject: string;
  why: string;
};

export type DiscernRootResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "discern";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSetupResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "setup";
  data?: {
    phase: "fresh" | "in_progress" | "done";
    complete: boolean;
    setup_completion?: "proven" | "unproven";
    next_action: string;
    agent_instructions?: string;
    human_framing?: string;
    progress?: {
      pending_markers: Array<string>;
      known_jobs: Array<{
        name: string;
        wired: boolean;
        not_applicable?: true;
      }>;
      assurance?: {
        known_jobs: Array<{
          name: string;
          state: "enforced" | "deferred" | "absent";
          not_applicable?: true;
          reason?: string;
          self_supplied?: true;
        }>;
        enforced: number;
        total: number;
        known_total?: number;
        not_applicable?: number;
        verdict: "full" | "partial" | "minimal";
        completion?: {
          standards: Array<string>;
          shared: Array<{
            producer: string;
            standards: Array<string>;
          }>;
          candidate_bound: Array<string>;
          declared: Array<string>;
        };
      };
    };
  } | {
    next_action: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSetupBeginResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "setup begin";
  data?: {
    complete?: boolean;
    next_action: string;
    already_set_up?: boolean;
    message?: string;
    project?: {
      slug: string;
      agents: Array<string>;
    };
    config_fills?: {
      filled: Array<string>;
      skipped: Array<string>;
    };
    plan?: Array<{
      path: string;
      action: "create" | "skip" | "merge" | "append" | "remove";
      note?: string;
    }>;
    command?: string;
    bootstrapped?: boolean;
    branch?: string | null;
    machinery_committed?: boolean;
    machinery_commit_error?: string;
    discern_version?: string;
    written?: Array<string>;
    instruction_refresh?: {
      status: "complete";
      compiled: Array<string>;
    } | {
      status: "partial";
      compiled: Array<string>;
      failures: Array<{
        kind: "artifact";
        evidence: string;
      }>;
      effects_preserved: true;
      recovery: {
        command: "discern refresh";
        safe_to_retry: true;
      };
    };
    mcp_wired?: Array<string>;
    hooks_wired?: Array<string>;
    worktree_app_wired?: Array<string>;
    project_rules_wired?: Array<string>;
    skeletons?: Array<string>;
    skipped?: Array<string>;
    instructions?: string;
    human_relay?: string;
    page?: {
      step: number;
      title: string;
      spine: {
        phase: string;
        stable_target: string;
        intent: string;
        files_to_read: Array<string>;
        must_do: Array<string>;
        authority_boundaries: Array<string>;
        what_not_to_do: Array<string>;
        completion_check: string;
        stop_conditions: Array<string>;
        recovery: Array<string>;
        next_action: string;
        owner_moments: Array<{
          id: string;
          kind: "explanation" | "progress" | "decision" | "completion";
          phase: string;
          purpose: string;
          applicability: {
            kind: "always";
          } | {
            kind: "when";
            evidence_id: string;
            condition: string;
          };
          fact_ids: Array<string>;
          recommendation?: string;
          decision?: {
            kind:
              | "model-selection"
              | "project-name-confirmation"
              | "project-intent-gap"
              | "gate-protection-change"
              | "authored-source-collision"
              | "owner-policy-conflict"
              | "subsystem-sanity-check"
              | "worktree-resource-policy"
              | "documentation-claim-gap"
              | "external-reference-inspection"
              | "landing-choice";
            recommended_option: string;
            option_ids: Array<string>;
            agent_waits_when_served: true;
            delegation: {
              allowed: true;
              action: "use-recommendation";
              selects_option: string;
            } | {
              allowed: false;
              reason: string;
            };
          };
          relay_protection: "adaptive" | "verbatim-list";
        }>;
        human_decisions: Array<string>;
        relay?: Array<string>;
      };
      instructions: string;
      next_action: string;
    } | null;
    changes?: Array<string>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSetupVerifyResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "setup verify";
  data?: {
    phase: "fresh" | "in_progress" | "done";
    next_action: string;
    ready?: boolean;
    findings?: {
      git: {
        repo: boolean;
        clean: boolean;
        uncommitted: number;
        identity: boolean;
      };
      docs: {
        exists: boolean;
      };
      existing_instructions: Array<string>;
      agents_detected: Array<string>;
      agents_effective: Array<string>;
      worktree_path: string;
      project_identity: {
        proposed_name: string;
        evidence: Array<{
          source: string;
          location: string;
          value: string;
        }>;
        fallback_only: boolean;
        requires_confirmation: true;
      };
    };
    conflicts?: Array<{
      kind:
        | "existing_instructions"
        | "dirty_worktree"
        | "not_a_repo"
        | "missing_git_identity";
      detail: string;
    }>;
    instructions?: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSetupStepResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "setup step";
  data?: {
    step: number;
    title: string;
    spine: {
      phase: string;
      stable_target: string;
      intent: string;
      files_to_read: Array<string>;
      must_do: Array<string>;
      authority_boundaries: Array<string>;
      what_not_to_do: Array<string>;
      completion_check: string;
      stop_conditions: Array<string>;
      recovery: Array<string>;
      next_action: string;
      owner_moments: Array<{
        id: string;
        kind: "explanation" | "progress" | "decision" | "completion";
        phase: string;
        purpose: string;
        applicability: {
          kind: "always";
        } | {
          kind: "when";
          evidence_id: string;
          condition: string;
        };
        fact_ids: Array<string>;
        recommendation?: string;
        decision?: {
          kind:
            | "model-selection"
            | "project-name-confirmation"
            | "project-intent-gap"
            | "gate-protection-change"
            | "authored-source-collision"
            | "owner-policy-conflict"
            | "subsystem-sanity-check"
            | "worktree-resource-policy"
            | "documentation-claim-gap"
            | "external-reference-inspection"
            | "landing-choice";
          recommended_option: string;
          option_ids: Array<string>;
          agent_waits_when_served: true;
          delegation: {
            allowed: true;
            action: "use-recommendation";
            selects_option: string;
          } | {
            allowed: false;
            reason: string;
          };
        };
        relay_protection: "adaptive" | "verbatim-list";
      }>;
      human_decisions: Array<string>;
      relay?: Array<string>;
    };
    instructions: string;
    next_action: string;
  } | {
    next_action: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSetupDoneResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "setup done";
  data?: {
    bootstrapped: true;
    completion: "created" | "replayed" | "validated" | "unproven";
    effects_performed: boolean;
    gate_ran: boolean;
    setup_completion: "proven" | "unproven";
    unproven: boolean;
    gate_proven: boolean;
    worktree_proven: boolean;
    marker_committed: boolean;
    marker_commit_error?: string;
    proof_line?: string;
    leftover: Array<string>;
    assurance: {
      known_jobs: Array<{
        name: string;
        state: "enforced" | "deferred" | "absent";
        not_applicable?: true;
        reason?: string;
        self_supplied?: true;
      }>;
      enforced: number;
      total: number;
      known_total?: number;
      not_applicable?: number;
      verdict: "full" | "partial" | "minimal";
      completion?: {
        standards: Array<string>;
        shared: Array<{
          producer: string;
          standards: Array<string>;
        }>;
        candidate_bound: Array<string>;
        declared: Array<string>;
      };
    };
    inventory: {
      project_context: {
        primary_subsystem: {
          region: string;
          page: string;
          title: string;
          start_here: string;
          boundary: string;
          non_obvious_invariant: string;
        } | null;
        principles: {
          count: number;
          items: Array<string>;
        };
        instruction_sources: Array<string>;
      };
      map_regions: {
        count: number;
        items: Array<string>;
      };
      ledger_items: {
        count: number;
        items: Array<string>;
      };
      jobs: {
        enforced: Array<string>;
        deferred: Array<string>;
        absent: Array<string>;
        not_applicable: Array<string>;
      };
    };
    landing: {
      in_repo: boolean;
      branch: string;
      target: string;
      on_target: boolean;
      on_setup_branch: boolean;
      command: string;
    };
    reactivation?: {
      summary: string;
      per_agent: Array<{
        agent: string;
        label: string;
        step: string;
        check_kind: "mcp" | "cli";
        check: string;
        recovery: string;
        cli_fallback: string;
        trust: {
          provider: string;
          required: boolean;
          explanation: string;
          actions: Array<{
            kind:
              | "verify-configuration"
              | "trust-directory"
              | "approve-hook"
              | "enable-hooks"
              | "approve-tools";
            instruction: string;
            facts: Array<{
              kind:
                | "path"
                | "config-key"
                | "config-value"
                | "flag"
                | "environment-variable";
              value: string;
            }>;
          }>;
        };
      }>;
    };
    optional_improvement?: {
      verb: string;
      command: string;
      after: "activation_verified";
    };
    instructions: string;
    next_action: string;
    proof?: {
      status:
        | "honored"
        | "report_only"
        | "missing"
        | "stale"
        | "dirty"
        | "unavailable"
        | "read_failed";
      path?: string;
      recorded?: string;
      head?: string;
      reason?: string;
      proof?: DiscernProofSummary;
      checkpoint_drops?: Array<
        {
          scope: "policy";
          checkpoint: null;
          mode: null;
          policy_commit?: string;
          reason:
            | "merge_base_unresolved"
            | "governing_config_unreadable"
            | "governing_config_invalid"
            | "open_question_store_unreadable"
            | "open_question_store_corrupt"
            | "declaration_evidence_unavailable"
            | "strand_check_unavailable";
          account: string;
        } | {
          scope: "checkpoint";
          checkpoint: string;
          mode: "stop" | "advise";
          policy_commit: string;
          reason:
            | "checkpoint_missing_question"
            | "checkpoint_question_file_missing"
            | "checkpoint_question_file_invalid_path"
            | "checkpoint_question_file_not_regular"
            | "checkpoint_question_file_oversized"
            | "checkpoint_question_file_invalid_utf8"
            | "checkpoint_question_file_unreadable"
            | "checkpoint_question_source_conflict"
            | "checkpoint_selector_conflict"
            | "checkpoint_unknown_scope"
            | "effort_diff_unreadable"
            | "trigger_content_unavailable"
            | "trigger_history_unavailable"
            | "when_spawn_failed"
            | "when_timeout"
            | "when_invalid_exit"
            | "when_cancelled"
            | "when_input_failed"
            | "when_input_cleanup_failed"
            | "when_output_limit"
            | "open_question_store_rebuilt"
            | "subject_unavailable"
            | "open_question_store_write_failed";
          account: string;
        }
      >;
    };
  } | {
    next_action: string;
    leftover: Array<string>;
    unmet: Array<{
      step: number;
      name: string;
      describe: string;
      passed: boolean;
    }>;
  } | {
    next_action: string;
    uncommitted: Array<string>;
    stage?: "refresh" | "final_tree";
  } | {
    stage:
      | "marker_commit"
      | "refresh"
      | "doctor"
      | "worktree_probe"
      | "done"
      | "proof";
    rollback: "not_needed" | "owned_commit_removed" | "retained";
    state: string;
    next_action: string;
    recovery: string;
  } | {
    next_action: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSetupAcceptResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "setup accept";
  data?: {
    next_action: string;
    landed: boolean;
    branch: string;
    target: string;
    fast_forward: boolean;
    branch_deleted: boolean;
    proof: {
      status:
        | "honored"
        | "report_only"
        | "missing"
        | "stale"
        | "dirty"
        | "unavailable"
        | "read_failed";
      path?: string;
      recorded?: string;
      head?: string;
      reason?: string;
      proof?: DiscernProofSummary;
      checkpoint_drops?: Array<
        {
          scope: "policy";
          checkpoint: null;
          mode: null;
          policy_commit?: string;
          reason:
            | "merge_base_unresolved"
            | "governing_config_unreadable"
            | "governing_config_invalid"
            | "open_question_store_unreadable"
            | "open_question_store_corrupt"
            | "declaration_evidence_unavailable"
            | "strand_check_unavailable";
          account: string;
        } | {
          scope: "checkpoint";
          checkpoint: string;
          mode: "stop" | "advise";
          policy_commit: string;
          reason:
            | "checkpoint_missing_question"
            | "checkpoint_question_file_missing"
            | "checkpoint_question_file_invalid_path"
            | "checkpoint_question_file_not_regular"
            | "checkpoint_question_file_oversized"
            | "checkpoint_question_file_invalid_utf8"
            | "checkpoint_question_file_unreadable"
            | "checkpoint_question_source_conflict"
            | "checkpoint_selector_conflict"
            | "checkpoint_unknown_scope"
            | "effort_diff_unreadable"
            | "trigger_content_unavailable"
            | "trigger_history_unavailable"
            | "when_spawn_failed"
            | "when_timeout"
            | "when_invalid_exit"
            | "when_cancelled"
            | "when_input_failed"
            | "when_input_cleanup_failed"
            | "when_output_limit"
            | "open_question_store_rebuilt"
            | "subject_unavailable"
            | "open_question_store_write_failed";
          account: string;
        }
      >;
    };
    proof_line?: string;
    validated_commit?: string;
    merge_validated: boolean;
    proof_note?: {
      fetch: {
        mode: "local" | "fetch";
        status: "local" | "wired" | "unchanged" | "no_remote" | "failed";
        remotes: Array<string>;
        added: Array<string>;
        removed: Array<string>;
        errors: Array<string>;
      };
      write: {
        status:
          | "recorded"
          | "already_present"
          | "record_failed"
          | "missing_proof";
        ref: string;
        commit: string;
        merged_refs: Array<string>;
        reason?: string;
      };
    };
    local_artifacts_converged: boolean;
    local_artifact_errors?: Array<string>;
    tracked_refresh_pending?: Array<string>;
    tracked_refresh_errors?: Array<string>;
    proof_cleared?: boolean;
    proof_clear_error?: string;
    reactivation?: {
      summary: string;
      per_agent: Array<{
        agent: string;
        label: string;
        step: string;
        check_kind: "mcp" | "cli";
        check: string;
        recovery: string;
        cli_fallback: string;
        trust: {
          provider: string;
          required: boolean;
          explanation: string;
          actions: Array<{
            kind:
              | "verify-configuration"
              | "trust-directory"
              | "approve-hook"
              | "enable-hooks"
              | "approve-tools";
            instruction: string;
            facts: Array<{
              kind:
                | "path"
                | "config-key"
                | "config-value"
                | "flag"
                | "environment-variable";
              value: string;
            }>;
          }>;
        };
      }>;
    };
    activation_context?: string;
    optional_improvement?: {
      command: string;
      after: "activation_verified";
    };
  } | {
    next_action: string;
    completion: {
      status: "no_op";
      reason: "no_git_repository" | "already_on_target";
    };
    target: string;
  } | {
    next_action: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernUpgradeResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "upgrade";
  data?: {
    check?: boolean;
    schema?: {
      recorded?: number;
      from?: number;
      current: number;
    };
    pending_migrations?: Array<{
      from: number;
      to: number;
      describe: string;
    }>;
    pending_reconciliation?: Array<{
      kind: "section" | "key" | "banner" | "marker";
      path: string;
    }>;
    config_template_available?: boolean;
    pending_gitignore_reconciliation?: Array<{
      kind: "create-block" | "replace-block";
      path: string;
    }>;
    gitignore_template_available?: boolean;
    pending_gitattributes_reconciliation?: Array<{
      kind: "create-block" | "replace-block" | "remove-block";
      path: string;
    }>;
    untranslated_gitattributes_patterns?: Array<{
      group: string;
      pattern: string;
      reason: string;
    }>;
    changes?: Array<string>;
    newer_records?: Array<string>;
    issues?: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
    discern_version?: string;
    migrations_applied?: Array<{
      from: number;
      to: number;
      describe: string;
    }>;
    config_reconciled?: Array<{
      kind: "section" | "key" | "banner" | "marker";
      path: string;
    }>;
    gitignore_reconciled?: Array<{
      kind: "create-block" | "replace-block";
      path: string;
    }>;
    gitattributes_reconciled?: Array<{
      kind: "create-block" | "replace-block" | "remove-block";
      path: string;
    }>;
    skills?: {
      copied: number;
      linked: number;
      pruned: number;
    } | null;
    mcp_wired?: Array<string>;
    hooks_wired?: Array<string>;
    worktree_app_wired?: Array<string>;
    project_rules_wired?: Array<string>;
    instruction_refresh?: {
      status: "complete";
      compiled: Array<string>;
    } | {
      status: "partial";
      compiled: Array<string>;
      failures: Array<{
        kind: "artifact";
        evidence: string;
      }>;
      effects_preserved: true;
      recovery: {
        command: "discern refresh";
        safe_to_retry: true;
      };
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernUninstallResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "uninstall";
  data?: {
    removed?: Array<string>;
    removed_runtime_state?: Array<string>;
    stripped?: Array<string>;
    kept?: Array<string>;
    binary_hint?: string;
    worktrees?: Array<string>;
    resources?: Array<string>;
    templates_available?: boolean;
    incomplete_strips?: Array<{
      rel: string;
      reason: string;
    }>;
    removed_git_config?: Array<string>;
    kept_git_config?: Array<string>;
    retained_refs?: Array<string>;
    optional_cleanup?: Array<string>;
    git_config_errors?: Array<string>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernDoctorResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "doctor";
  data?: {
    discern_version: string;
    environment: {
      discern: string;
      platform: string;
      git?: string;
      desk_session?: true;
    };
    checks: Array<{
      name: string;
      status: "ok" | "warn" | "fail";
      ok: boolean;
      detail: string;
      fix?: string;
      warn?: boolean;
    }>;
    provider_trust?: Array<{
      provider: string;
      required: boolean;
      explanation: string;
      actions: Array<{
        kind:
          | "verify-configuration"
          | "trust-directory"
          | "approve-hook"
          | "enable-hooks"
          | "approve-tools";
        instruction: string;
        facts: Array<{
          kind:
            | "path"
            | "config-key"
            | "config-value"
            | "flag"
            | "environment-variable";
          value: string;
        }>;
      }>;
    }>;
    execution_model?: Array<{
      verb: string;
      when: string;
      steps: Array<{
        kind:
          | "job"
          | "scope-gate"
          | "merge-check"
          | "standards-limits-check"
          | "tracked-artifacts-check"
          | "instructions-check"
          | "skills-check"
          | "tracked-refresh-check"
          | "resource-create"
          | "resource-destroy"
          | "git"
          | "task-metadata"
          | "setup-step"
          | "repository-ensure"
          | "checkout-clean-check"
          | "setup-ensure"
          | "env"
          | "refresh"
          | "tidy"
          | "standard";
        label: string;
        actor: "project" | "discern";
        note?: string;
        hint?: string;
        condition?: string;
      }>;
    }>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernLicensesResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "licenses";
  data?: {
    documents: Array<{
      key: string;
      kind: "license" | "notice";
      identifier: string;
      title: string;
      path: string;
      text: string;
    }>;
    components: Array<{
      name: string;
      version: string;
      registry: string;
      license: string;
    }>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernTriangleResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "triangle";
  data?: {
    mark: string;
    art: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernMapResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "map";
  data?: {
    map_dir?: string;
    count?: number;
    docs?: Array<{
      target?: string;
      path: string;
      section: string;
      slug: string;
      title: string;
      description: string;
      publish?: boolean;
      order?: number;
      aliases?: Array<string>;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
    }>;
    regions?: Array<{
      name: string;
      title: string;
      description: string;
      page_count: number;
      pages_changed_at?: string;
      code_changes_since?: number;
    }>;
    doc?: {
      target: string;
      path: string;
      section: string;
      slug: string;
      title: string;
      description: string;
      publish?: boolean;
      order?: number;
      aliases?: Array<string>;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
      content: string;
      cited_adrs?: Array<{
        number: string;
        slug: string;
        path: string;
      }>;
    };
    candidates?: Array<string>;
    suggestions?: Array<{
      target?: string;
      path: string;
      section: string;
      slug: string;
      title: string;
      description: string;
      publish?: boolean;
      order?: number;
      aliases?: Array<string>;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
    }>;
    query?: string;
    scope?: string;
    results?: Array<{
      target: string;
      path: string;
      section: string;
      title: string;
      description: string;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
      match: "complete" | "partial" | "metadata";
      heading?: string;
      snippet: string;
    }>;
    truncated?: boolean;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernDocsResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "docs";
  data?: {
    map_dir?: string;
    count?: number;
    docs?: Array<{
      target?: string;
      path: string;
      section: string;
      slug: string;
      title: string;
      description: string;
      publish?: boolean;
      order?: number;
      aliases?: Array<string>;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
    }>;
    regions?: Array<{
      name: string;
      title: string;
      description: string;
      page_count: number;
      pages_changed_at?: string;
      code_changes_since?: number;
    }>;
    doc?: {
      target: string;
      path: string;
      section: string;
      slug: string;
      title: string;
      description: string;
      publish?: boolean;
      order?: number;
      aliases?: Array<string>;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
      content: string;
      cited_adrs?: Array<{
        number: string;
        slug: string;
        path: string;
      }>;
    };
    candidates?: Array<string>;
    suggestions?: Array<{
      target?: string;
      path: string;
      section: string;
      slug: string;
      title: string;
      description: string;
      publish?: boolean;
      order?: number;
      aliases?: Array<string>;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
    }>;
    query?: string;
    scope?: string;
    results?: Array<{
      target: string;
      path: string;
      section: string;
      title: string;
      description: string;
      page_id?: string;
      manual_kind?:
        | "tutorial"
        | "guide"
        | "explanation"
        | "reference"
        | "troubleshooting";
      match: "complete" | "partial" | "metadata";
      heading?: string;
      snippet: string;
    }>;
    truncated?: boolean;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernHelpResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "help";
  data?: {
    command: __schema0;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernConfigResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "config";
  data?: {
    operation: "edit";
    file: string;
    edits: Array<{
      key: string;
      literal: string | null;
    }>;
  } | {
    operation: "get";
    key: string;
    value: string;
  } | {
    operation: "array" | "subsections" | "keys";
    key: string;
    values: Array<string>;
  } | {
    operation: "has";
    key: string;
    present: boolean;
  } | {
    operation: "explain";
    path: string;
    kind: "section" | "family" | "key";
    what?: string;
    why?: string;
    detail?: Array<string>;
    params?: Array<string>;
    keys?: Array<{
      name: string;
      type: string;
      default?: string;
      description: string;
    }>;
    type?: string;
    default?: string;
    description?: string;
    value?: string;
    examples?: Array<{
      lead: string;
      toml: string;
    }>;
    reference: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernDoneResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "done";
  data?: {
    emergency_validation?: Array<{
      landing_id: string;
      head: string;
      reason: string;
      exceptions: Array<{
        requirement: {
          id: string;
          kind: "job" | "scope" | "standard";
          definition: string;
        };
        state: "failed" | "unrun" | "stale";
        evidence_id: string | null;
      }>;
      state: "outstanding" | "resolved";
      resolved_by?: {
        candidate_id: string;
        proof_id: string;
      };
      next_action: string;
    }>;
    producer_executions?: {
      [key: string]: number;
    };
    producer_evidence?: Array<{
      producer: string;
      use: "executed" | "reused";
      closure: "declared" | "candidate";
      reason: string;
      evidence_id?: string;
      from?: string;
    }>;
    completion?: {
      kind: "diagnostic" | "complete" | "pending";
      candidate_id?: string;
      proof_id?: string;
      pending_reasons: Array<string>;
      pending?: Array<{
        kind: string;
        reason: string;
      }>;
    };
    mode?: "strict" | "report";
    gate_ran?: boolean;
    failed_stage:
      | "fix"
      | "build"
      | "check"
      | "test"
      | "check/test"
      | "scope_gates"
      | "tree_drift"
      | "generated_drift"
      | "refresh_drift"
      | "tracked_artifacts"
      | "instructions"
      | "skills"
      | "skill_frontmatter"
      | "adr_numbers"
      | "adr_index"
      | "map_integrity"
      | "merge"
      | "standards"
      | "write_access"
      | null;
    scopes_changed: Array<string>;
    preview_actions?: Array<{
      scope: string;
      command: string;
    }>;
    standards?: Array<{
      name: string;
      direction: "up" | "down";
      limit: number;
      margin?: number;
      measurement: "measured" | "replayed" | "skipped" | "cancelled" | "stale";
      value?: number;
      verdict?: "improved" | "held" | "regressed";
      duration_s?: number;
      replayed_from?: string;
      pin_eligible?: boolean;
      pin_target?: number;
    }>;
    standards_limits?: {
      status:
        | "verified"
        | "proposed"
        | "loosened"
        | "unverified"
        | "parse_failed";
      trunk: string;
      reason?: string;
    };
    checkpoints?: {
      policy?: string;
      outstanding?: Array<{
        id: string;
        mode: "stop" | "advise";
        question: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        matched: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      declared_met?: Array<{
        id: string;
        question?: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        declared_at: string;
        matched?: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      declared_unmet?: Array<{
        id: string;
        question?: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        why: string;
        declared_at: string;
        matched?: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      advise?: Array<{
        id: string;
        mode: "stop" | "advise";
        question: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        matched: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      review?: {
        enforcement: "reported";
        status: "not_needed" | "unreviewed";
        unreviewed?: Array<{
          id: string;
          mode: "stop" | "advise";
          question: string;
          question_file?: string;
          teach?: string;
          reference?: string;
          matched: Array<string>;
          related?: Array<{
            kind: "similar_existing";
            for_path: string;
            path: string;
          }>;
        }>;
      };
      drops?: Array<
        {
          scope: "policy";
          checkpoint: null;
          mode: null;
          policy_commit?: string;
          reason:
            | "merge_base_unresolved"
            | "governing_config_unreadable"
            | "governing_config_invalid"
            | "open_question_store_unreadable"
            | "open_question_store_corrupt"
            | "declaration_evidence_unavailable"
            | "strand_check_unavailable";
          account: string;
        } | {
          scope: "checkpoint";
          checkpoint: string;
          mode: "stop" | "advise";
          policy_commit: string;
          reason:
            | "checkpoint_missing_question"
            | "checkpoint_question_file_missing"
            | "checkpoint_question_file_invalid_path"
            | "checkpoint_question_file_not_regular"
            | "checkpoint_question_file_oversized"
            | "checkpoint_question_file_invalid_utf8"
            | "checkpoint_question_file_unreadable"
            | "checkpoint_question_source_conflict"
            | "checkpoint_selector_conflict"
            | "checkpoint_unknown_scope"
            | "effort_diff_unreadable"
            | "trigger_content_unavailable"
            | "trigger_history_unavailable"
            | "when_spawn_failed"
            | "when_timeout"
            | "when_invalid_exit"
            | "when_cancelled"
            | "when_input_failed"
            | "when_input_cleanup_failed"
            | "when_output_limit"
            | "open_question_store_rebuilt"
            | "subject_unavailable"
            | "open_question_store_write_failed";
          account: string;
        }
      >;
      advisories?: Array<string>;
    };
    gate_proof?: {
      status:
        | "recorded"
        | "diagnostic"
        | "pending"
        | "skipped_dirty"
        | "skipped_head_moved"
        | "unavailable"
        | "record_failed"
        | "cleared"
        | "clear_failed";
      path?: string;
      reason?: string;
    };
    proof?: DiscernProofSummary;
    landing_authority?: {
      kind: "authorized" | "conversation-required";
      source?: "conversation" | "standing-grant" | "effort-grant";
      scopes?: Array<string>;
      standing_scopes?: Array<string>;
      uncovered_scopes?: Array<string>;
      uncovered_unscoped_total?: number;
      uncovered_generated_total?: number;
      warnings?: Array<string>;
      uncovered?: Array<{
        path: string;
        scopes: Array<string>;
        generated?: boolean;
      }>;
      uncovered_total?: number;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernPrepareResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "prepare";
  data?: {
    producer_executions: {
      [key: string]: number;
    };
    producer_evidence?: Array<{
      producer: string;
      use: "executed" | "reused";
      closure: "declared" | "candidate";
      reason: string;
      evidence_id?: string;
      from?: string;
    }>;
    standards?: Array<{
      name: string;
      direction: "up" | "down";
      limit: number;
      margin?: number;
      measurement: "measured" | "replayed" | "skipped" | "cancelled" | "stale";
      value?: number;
      verdict?: "improved" | "held" | "regressed";
      duration_s?: number;
      replayed_from?: string;
      pin_eligible?: boolean;
      pin_target?: number;
    }>;
    measurement?: "none";
    completion?: {
      kind: "diagnostic";
      proof: "not-issued";
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernTestResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "test";
  data?: {
    producer_executions: {
      [key: string]: number;
    };
    producer_evidence?: Array<{
      producer: string;
      use: "executed" | "reused";
      closure: "declared" | "candidate";
      reason: string;
      evidence_id?: string;
      from?: string;
    }>;
    standards?: Array<{
      name: string;
      direction: "up" | "down";
      limit: number;
      margin?: number;
      measurement: "measured" | "replayed" | "skipped" | "cancelled" | "stale";
      value?: number;
      verdict?: "improved" | "held" | "regressed";
      duration_s?: number;
      replayed_from?: string;
      pin_eligible?: boolean;
      pin_target?: number;
    }>;
    measurement?: "none";
    completion?: {
      kind: "diagnostic";
      proof: "not-issued";
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernImprovementResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "improvement";
  data?: {
    score: number;
    weak: number;
    open_reviews: number;
    next_action: {
      kind: "fix" | "review" | "decide";
      category: string;
      id: string;
      title: string;
      action: string;
      why: string;
      against?: {
        source: string;
        excerpt: string;
      };
    };
    recommendations?: Array<{
      id: "checkpoints.review" | "checkpoints.graduate";
      subject: string;
      title: string;
      action: string;
      why: string;
      evidence: {
        source: string;
        excerpt: string;
      };
    }>;
    categories: Array<{
      name: string;
      title: string;
      score: number;
      weight: number;
      weak: number;
      rules: Array<{
        id: string;
        title: string;
        status: "pass" | "partial" | "fail";
        weight: number;
        detail: string;
        fix?: string;
        teach: string;
      }>;
      reviews: Array<{
        id: string;
        title: string;
        ask: string;
        teach: string;
        against?: {
          source: string;
          excerpt: string;
        };
        boundary?: Array<{
          checkpoint: string;
          mode: "stop" | "advise";
        }>;
      }>;
    }>;
    history: {
      findings: Array<{
        detector: string;
        family: "trajectory" | "gate-fit" | "behavior" | "funnel";
        scope: "branch" | "session" | "project";
        tone: "good" | "neutral" | "attention";
        subject?: string;
        summary: string;
        series?: Array<number>;
        observed: string;
        evidence: {
          [key: string]: number;
        };
        basis?: {
          kind: string;
          coverage: {
            comparable: number;
            denominator: number;
            unit: string;
          };
          validation_state: {
            version: number | null;
            complete: boolean;
          };
          matched_conditions: Array<{
            dimension: string;
            values: Array<string>;
            distinct: number;
            omitted: number;
          }>;
          differing_conditions: Array<{
            dimension: string;
            values: Array<string>;
            distinct: number;
            omitted: number;
          }>;
          excluded_events: number;
          limitations: Array<string>;
          values: {
            [key: string]: {
              value: number;
              kind: "observed" | "estimated";
            };
          };
        };
        strength: number;
        next_step: string;
      }>;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernCheckpointsResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "checkpoints";
  data?: {
    policy?: string;
    checkpoints: Array<{
      id: string;
      mode: "stop" | "advise";
      question: string;
      question_file?: string;
      teach?: string;
      reference?: string;
      trigger: string;
      obligation:
        | "none"
        | "will_open"
        | "awaiting_declaration"
        | "reopened"
        | "declared_met"
        | "declared_unmet"
        | "unknown";
      preview?: {
        holds: boolean;
        when_pending?: boolean;
        matched?: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
        vetoed_by?:
          | "empty_matched_set"
          | "generated_only"
          | "excluded_only"
          | "kinds"
          | "adds_matching"
          | "removes_matching"
          | "new_directory"
          | "binary"
          | "unless_changed"
          | "min_changed_files"
          | "min_changed_lines"
          | "deletion_dominant"
          | "similar_new_file"
          | "min_commits";
      };
      open_question?: {
        state:
          | "awaiting_declaration"
          | "declared_met"
          | "declared_unmet"
          | "reopened";
        definition_hash: string;
        subject: string;
        matched: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
        opened_at: string;
        reopened_at?: string;
        declaration?: {
          conclusion: "met" | "unmet";
          why?: string;
          declared_at: string;
          current: boolean;
        };
        variance_required?: boolean;
      };
    }>;
    ungoverned?: Array<{
      id: string;
      open_question: {
        state:
          | "awaiting_declaration"
          | "declared_met"
          | "declared_unmet"
          | "reopened";
        definition_hash: string;
        subject: string;
        matched: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
        opened_at: string;
        reopened_at?: string;
        declaration?: {
          conclusion: "met" | "unmet";
          why?: string;
          declared_at: string;
          current: boolean;
        };
        variance_required?: boolean;
      };
    }>;
    economics?: {
      efforts: number;
      rows: Array<{
        id: string;
        efforts_fired: number;
        efforts_landed: number;
        fires: number;
        declared: number;
        declared_unchanged: number;
        declared_unmet: number;
        reopened: number;
        variances: number;
        abandoned: number;
        median_declare_s?: number;
      }>;
      omitted: number;
    };
    drops?: Array<
      {
        scope: "policy";
        checkpoint: null;
        mode: null;
        policy_commit?: string;
        reason:
          | "merge_base_unresolved"
          | "governing_config_unreadable"
          | "governing_config_invalid"
          | "open_question_store_unreadable"
          | "open_question_store_corrupt"
          | "declaration_evidence_unavailable"
          | "strand_check_unavailable";
        account: string;
      } | {
        scope: "checkpoint";
        checkpoint: string;
        mode: "stop" | "advise";
        policy_commit: string;
        reason:
          | "checkpoint_missing_question"
          | "checkpoint_question_file_missing"
          | "checkpoint_question_file_invalid_path"
          | "checkpoint_question_file_not_regular"
          | "checkpoint_question_file_oversized"
          | "checkpoint_question_file_invalid_utf8"
          | "checkpoint_question_file_unreadable"
          | "checkpoint_question_source_conflict"
          | "checkpoint_selector_conflict"
          | "checkpoint_unknown_scope"
          | "effort_diff_unreadable"
          | "trigger_content_unavailable"
          | "trigger_history_unavailable"
          | "when_spawn_failed"
          | "when_timeout"
          | "when_invalid_exit"
          | "when_cancelled"
          | "when_input_failed"
          | "when_input_cleanup_failed"
          | "when_output_limit"
          | "open_question_store_rebuilt"
          | "subject_unavailable"
          | "open_question_store_write_failed";
        account: string;
      }
    >;
    advisories?: Array<string>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernProgressResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "progress";
  data?: {
    handle: string;
    record_path?: string;
    operation: {
      verb: string;
      path: string;
      branch?: string;
      started_at: number;
      finished_at?: number;
    };
    executor: "running" | "gone" | "unknown";
    executor_reason?: string;
    outcome?: "completed" | "failed" | "cancelled";
    progress?: {
      phase: "producer" | "queue" | "pending" | "operation";
      state: string;
      candidate_id: string | null;
      reason: string;
      operation_handle?: string;
      next?: string;
      owner_must_act?: boolean;
      work?: {
        producer: string;
        state?: "running" | "passed" | "failed" | "cancelled";
        units?: {
          kind: string;
          completed: number;
          total: number | null;
        };
        results?: {
          passed?: number;
          failed?: number;
          skipped?: number;
        };
        active?: Array<string>;
        elapsed_ms?: number;
        partial?: boolean;
        output_path?: string;
      };
      attempt_id?: string;
    };
    producers?: Array<{
      producer: string;
      state?: "running" | "passed" | "failed" | "cancelled";
      units?: {
        kind: string;
        completed: number;
        total: number | null;
      };
      results?: {
        passed?: number;
        failed?: number;
        skipped?: number;
      };
      active?: Array<string>;
      elapsed_ms?: number;
      partial?: boolean;
      output_path?: string;
    }>;
    failures?: Array<{
      producer: string;
      name: string;
      message: string;
      file?: string;
      line?: number;
      reproduce_cmd?: string;
      partial: boolean;
    }>;
    timings?: Array<{
      category: string;
      interval_id: string;
      started_at: number;
      finished_at: number;
    }>;
    result?: unknown;
    result_truncated?: boolean;
    result_path?: string;
    result_retention_error?: string;
    account: Array<string>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernStandardsResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "standards";
  data?: {
    producer_executions?: {
      [key: string]: number;
    };
    producer_evidence?: Array<{
      producer: string;
      use: "executed" | "reused";
      closure: "declared" | "candidate";
      reason: string;
      evidence_id?: string;
      from?: string;
    }>;
    standards?: Array<{
      name: string;
      direction: "up" | "down";
      limit: number;
      margin?: number;
      measurement: "measured" | "replayed" | "skipped" | "cancelled" | "stale";
      value?: number;
      verdict?: "improved" | "held" | "regressed";
      duration_s?: number;
      replayed_from?: string;
      pin_eligible?: boolean;
      pin_target?: number;
    }>;
    pinned?: Array<{
      name: string;
      from: number;
      to: number;
      measured: number;
    }>;
    proposal?: {
      status: "recorded" | "rebound" | "replaced" | "unchanged" | "recovered";
      proposal: {
        standard: string;
        commit: string;
        bound_commit: string;
        measured_commit: string;
        definition_fingerprint: string;
        trunk: string;
        trunk_commit: string;
        direction: "up" | "down";
        trunk_limit: number;
        proposed_limit: number;
        measurement: number;
        delta: number;
        reason: string;
        evidence_paths: Array<string>;
      };
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernStandardsProposeResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "standards propose";
  data?: {
    producer_executions?: {
      [key: string]: number;
    };
    producer_evidence?: Array<{
      producer: string;
      use: "executed" | "reused";
      closure: "declared" | "candidate";
      reason: string;
      evidence_id?: string;
      from?: string;
    }>;
    standards?: Array<{
      name: string;
      direction: "up" | "down";
      limit: number;
      margin?: number;
      measurement: "measured" | "replayed" | "skipped" | "cancelled" | "stale";
      value?: number;
      verdict?: "improved" | "held" | "regressed";
      duration_s?: number;
      replayed_from?: string;
      pin_eligible?: boolean;
      pin_target?: number;
    }>;
    pinned?: Array<{
      name: string;
      from: number;
      to: number;
      measured: number;
    }>;
    proposal?: {
      status: "recorded" | "rebound" | "replaced" | "unchanged" | "recovered";
      proposal: {
        standard: string;
        commit: string;
        bound_commit: string;
        measured_commit: string;
        definition_fingerprint: string;
        trunk: string;
        trunk_commit: string;
        direction: "up" | "down";
        trunk_limit: number;
        proposed_limit: number;
        measurement: number;
        delta: number;
        reason: string;
        evidence_paths: Array<string>;
      };
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernRefreshResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "refresh";
  data?: {
    agents_written: Array<string>;
    mcp_wired: Array<string>;
    hooks_wired: Array<string>;
    worktree_app_wired: Array<string>;
    project_rules_wired: Array<string>;
    proof_notes_fetch_changed?: Array<string>;
    adr_index_written: Array<string>;
    skills: {
      copied: number;
      linked: number;
      pruned: number;
    };
    errors: Array<string>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernTidyResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "tidy";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernImpactResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "impact";
  data?: {
    scopes: Array<string>;
    preview_actions?: Array<{
      scope: string;
      command: string;
    }>;
    membership?: {
      scope: string;
      present: boolean;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernCouplingResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "coupling";
  data?: {
    mode: "diff" | "query" | "evidence";
    changed?: Array<string>;
    target?: string;
    partners: Array<{
      path: string;
      from: string;
      cochanges: number;
      of: number;
      confidence: number;
      lift: number;
    }>;
    excluded_generated?: Array<{
      path: string;
      group: string;
    }>;
    a?: string;
    b?: string;
    together?: number;
    of_a?: number;
    of_b?: number;
    commits?: Array<{
      sha: string;
      date: string;
      subject: string;
    }>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernAwaitResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "await";
  data?: {
    condition: "green" | "landed" | "trunk-moved";
    branch?: string;
    trunk: string;
    met: boolean;
    elapsed_ms: number;
    timeout_s: number;
    timeout_basis:
      | "explicit"
      | "cli"
      | "long-client"
      | "strict-client"
      | "unknown-client"
      | "cache-window";
    requested_timeout_s?: number;
    observed: {
      proof_status?:
        | "honored"
        | "report_only"
        | "missing"
        | "stale"
        | "dirty"
        | "unavailable"
        | "read_failed"
        | "no-worktree";
      worktree?: string;
      tip?: string;
      landed?: boolean;
      trunk_start?: string;
      trunk_head?: string;
      behind?: number | "unknown";
      incoming_overlap?: Array<string>;
      overlap_total?: number;
    };
    resume?: string;
    retry_after_s?: number;
    retry_basis?:
      | "explicit"
      | "cli"
      | "long-client"
      | "strict-client"
      | "unknown-client"
      | "cache-window";
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernPatternsResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "patterns";
  data?: {
    logbook: {
      source: {
        kind: "active";
      } | {
        kind: "archive";
        filename: string;
      };
      events: number;
      unparsed: number;
      setup_era: number;
      months: number;
      first_at?: string;
      last_at?: string;
      branches: number;
      recording: boolean;
    };
    population: {
      analyzed: number;
      agent: number;
      human: number;
      automation: number;
      unknown: number;
      identities: Array<{
        agent: string;
        label: string;
        runs: number;
      }>;
    };
    findings: Array<{
      detector: string;
      family: "trajectory" | "gate-fit" | "behavior" | "funnel";
      scope: "branch" | "session" | "project";
      tone: "good" | "neutral" | "attention";
      subject?: string;
      summary: string;
      series?: Array<number>;
      observed: string;
      evidence: {
        [key: string]: number;
      };
      basis?: {
        kind: string;
        coverage: {
          comparable: number;
          denominator: number;
          unit: string;
        };
        validation_state: {
          version: number | null;
          complete: boolean;
        };
        matched_conditions: Array<{
          dimension: string;
          values: Array<string>;
          distinct: number;
          omitted: number;
        }>;
        differing_conditions: Array<{
          dimension: string;
          values: Array<string>;
          distinct: number;
          omitted: number;
        }>;
        excluded_events: number;
        limitations: Array<string>;
        values: {
          [key: string]: {
            value: number;
            kind: "observed" | "estimated";
          };
        };
      };
      strength: number;
      next_step: string;
    }>;
    findings_total?: number;
    investigations: Array<{
      id: string;
      title: string;
      finding_ids: Array<string>;
      subject?: string;
      observations: Array<{
        finding_id: string;
        subject?: string;
        observed: string;
        denominator: {
          value: number;
          unit: string;
        };
        values: {
          [key: string]: {
            value: number;
            kind: "observed" | "estimated";
          };
        };
      }>;
      evidence_boundary: {
        validation_versions: Array<number>;
        complete_validation_state: boolean;
        setup_conditions: Array<{
          dimension: string;
          values: Array<string>;
          distinct: number;
          omitted: number;
        }>;
        excluded_events: number;
        limitations: Array<string>;
      };
      summary: string;
      observed: string;
      diagnostic_action: string;
      falsifier: string;
    }>;
    detectors: Array<{
      id: string;
      title: string;
      family: "trajectory" | "gate-fit" | "behavior" | "funnel";
      scope: "branch" | "session" | "project";
      tier: "inline" | "batch";
      status: "fired" | "quiet" | "insufficient-evidence";
      considered: number;
      threshold: number;
      findings: number;
    }>;
    stats?: {
      series_days_per_point?: number;
      accepted: {
        count: number;
        branches: number;
        insertions: number;
        deletions: number;
        files: number;
        commits: number;
        cleanups: number;
        per_day?: Array<number>;
        biggest?: {
          branch?: string;
          lines: number;
          files: number;
          day: string;
        };
        best_day?: {
          day: string;
          accepted: number;
        };
        longest_streak: number;
      };
      gate: {
        runs: number;
        greens: number;
        first_try_green_branches: number;
        gated_branches: number;
        longest_green_streak: number;
        current_green_streak: number;
        check_hours: number;
        greens_per_day?: Array<number>;
      };
      validation_workflows: {
        runs: {
          total: number;
          branches: number;
          by_verb: Array<{
            verb: "prepare" | "test" | "done";
            runs: number;
            branches: number;
            clean: number;
            dirty: number;
            unknown: number;
            successes: number;
            failures: number;
            retries: number;
          }>;
          evidence: {
            denominator: number;
            complete: number;
            incomplete: number;
            unattributed: number;
          };
          dirty_state: {
            denominator: number;
            tracked_only: number;
            untracked_only: number;
            mixed: number;
            unclassified: number;
          };
        };
        cycles: {
          total: number;
          branches: number;
          routes: Array<{
            route: "test-first" | "commit-first" | "unattributed";
            cycles: number;
            branches: number;
            runs: number;
            successful_cycles: number;
            successful_runs: number;
            failed_cycles: number;
            failed_runs: number;
            retried_cycles: number;
            retry_runs: number;
          }>;
          precommit_to_clean_gate: {
            cycles: number;
            branches: number;
            runs: number;
            retry_runs: number;
          };
        };
        cohorts?: {
          denominator_cycles: number;
          denominator_runs: number;
          identities: Array<{
            agent: string;
            label: string;
            cycles: number;
            runs: number;
            test_first_cycles: number;
            commit_first_cycles: number;
            successful_cycles: number;
            failed_cycles: number;
            retried_cycles: number;
          }>;
          below_minimum: {
            cohorts: number;
            cycles: number;
            runs: number;
          };
          unattributed: {
            cycles: number;
            runs: number;
          };
        };
      };
      cycles?: {
        started: number;
        completed: number;
        under_day: number;
        median_hours: number;
        fastest_hours: number;
      };
      standards: {
        pins: number;
        standards: number;
        trend?: Array<number>;
        most_improved?: {
          standard: string;
          from: number;
          to: number;
          better_percent: number;
        };
      };
      agents: {
        detected: number;
        per_day?: Array<number>;
        identities: Array<{
          agent: string;
          label: string;
          runs: number;
          done_runs: number;
          greens: number;
          per_day?: Array<number>;
        }>;
        below_minimum?: {
          agents: number;
          runs: number;
        };
        unattributed_runs: number;
      };
      checkpoints?: {
        efforts: number;
        rows: Array<{
          id: string;
          efforts_fired: number;
          efforts_landed: number;
          fires: number;
          declared: number;
          declared_unchanged: number;
          declared_unmet: number;
          reopened: number;
          variances: number;
          abandoned: number;
          median_declare_s?: number;
        }>;
        omitted: number;
      };
      breadth: {
        branches: number;
        active_days: number;
        span_days: number;
        first_day?: string;
        last_day?: string;
        busiest_day?: {
          day: string;
          branches: number;
        };
        branches_per_day?: Array<number>;
        peak_in_flight?: {
          branches: number;
          day: string;
        };
      };
    };
    completion?: {
      window: {
        first_at: number | null;
        last_at: number | null;
      };
      observations: number;
      duplicate_observations: number;
      conflicting_identities: number;
      conflicting_component_receipts: number;
      efforts: number;
      candidates: number;
      attempts: number;
      executor_operations: number;
      component_receipts: {
        [key: string]: number;
      };
      executed_component_groups: number;
      reused_receipts: number;
      unknown_component_use_identity: number;
      producer_executions: number | null;
      extractor_executions?: number | null;
      producer_results?: {
        [key: string]: number;
      };
      producer_result_missing?: number;
      unknown_command_identity?: number;
      conflicting_command_identities?: number;
      unmatched_command_results?: number;
      producer_work_ms?: number | null;
      latencies?: {
        [key: string]: {
          observations: number;
          unknown: number;
          median_ms: number | null;
          min_ms: number | null;
          max_ms: number | null;
        };
      };
      timing: {
        [key: string]: {
          observations: number;
          unknown: number;
          sum_ms: number | null;
          elapsed_ms: number | null;
        };
      };
      observed_wall: {
        observations: number;
        unknown: number;
        sum_ms: number | null;
        elapsed_ms: number | null;
      };
      invalidations: {
        [key: string]: number;
      };
      validation_runs?: number;
      reuse_only_runs?: number;
      proofs: number;
      limitations: Array<string>;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernPatternsResetResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "patterns reset";
  data?: {
    dir: string;
    removed: Array<{
      file: string;
      bytes: number;
    }>;
    bytes: number;
    events: number;
    unparsed: number;
    first_at?: string;
    last_at?: string;
    impacts: Array<{
      key: string;
      phrase: string;
      surface: string;
    }>;
    recovery_path?: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernPatternsSealResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "patterns seal";
  data?: {
    source_dir: string;
    destination_dir: string;
    archive_file: string;
    archive_path: string;
    files: Array<{
      file: string;
      bytes: number;
    }>;
    source_bytes: number;
    archive_bytes: number;
    events: number;
    unparsed: number;
    first_at?: string;
    last_at?: string;
    recovery_path?: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernPatternsArchivesResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "patterns archives";
  data?: {
    dir: string;
    archives: Array<{
      filename: string;
      events: number;
      unparsed: number;
      bytes: number;
      first_at?: string;
      last_at?: string;
    }>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernDeskResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "desk";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernEnterResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "enter";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernStatusResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "status";
  data?: {
    emergency_validation?: Array<{
      landing_id: string;
      head: string;
      reason: string;
      exceptions: Array<{
        requirement: {
          id: string;
          kind: "job" | "scope" | "standard";
          definition: string;
        };
        state: "failed" | "unrun" | "stale";
        evidence_id: string | null;
      }>;
      state: "outstanding" | "resolved";
      resolved_by?: {
        candidate_id: string;
        proof_id: string;
      };
      next_action: string;
    }>;
    location: "main" | "worktree";
    root: string;
    project?: string;
    worktree: {
      id: string;
      branch: string;
      site: string;
      port: number;
      db: string;
      seed: number;
      resources: {
        [key: string]: string;
      };
    } | null;
    git: {
      branch: string;
      trunk: string;
      clean: boolean;
      changed_files: number;
      behind_trunk: number | "unknown" | null;
      ahead_trunk: number | "unknown" | null;
      incoming_overlap?: Array<string>;
    } | null;
    scopes?: Array<string>;
    preview_actions?: Array<{
      scope: string;
      command: string;
    }>;
    gate?: {
      jobs: Array<string>;
      scope_gates: Array<string>;
    };
    standards: Array<string>;
    landed_proof_stale?: {
      commit: string;
      ref: string;
      reason: string;
    };
    landed_proof_unsupported?: {
      commit: string;
      ref: string;
      format: string;
    };
    landed_exception?: {
      commit: string;
      ref: string;
      landing_id: string;
      reason: string;
      exceptions: number;
      validation: "outstanding" | "resolved";
    };
    pending_tracked_refresh?: Array<string>;
    tracked_refresh_plan_errors?: Array<string>;
    tracked_ignored_artifacts?: Array<string>;
    setup_completion?: "proven" | "unproven";
    setup_unfinished?: {
      pending_markers: Array<string>;
      known_jobs: Array<{
        name: string;
        wired: boolean;
        not_applicable?: true;
      }>;
      assurance?: {
        known_jobs: Array<{
          name: string;
          state: "enforced" | "deferred" | "absent";
          not_applicable?: true;
          reason?: string;
          self_supplied?: true;
        }>;
        enforced: number;
        total: number;
        known_total?: number;
        not_applicable?: number;
        verdict: "full" | "partial" | "minimal";
        completion?: {
          standards: Array<string>;
          shared: Array<{
            producer: string;
            standards: Array<string>;
          }>;
          candidate_bound: Array<string>;
          declared: Array<string>;
        };
      };
    };
    unlanded_branches?: Array<string>;
    parked_tasks?: Array<{
      id: string;
      branch: string;
      head: string;
      parked_at: string;
      task: {
        id: string;
        branch: string;
        title: string;
        title_source: "recorded" | "identity-fallback" | "unavailable-fallback";
        brief?: string;
        created_from?: {
          ref: string;
          commit: string;
        };
        unavailable_reason?: string;
      };
    }>;
    parked_tasks_unavailable?: {
      reason: string;
      next_command: string;
    };
    contained_refs?: Array<{
      branch: string;
      contained_in: string;
    }>;
    queue?: Array<DiscernSubmissionRow>;
    operation?: {
      verb: string;
      branch?: string;
      handle: string;
      latest?: string;
    };
    recent_completed_tasks?: Array<{
      branch: string;
      head?: string;
      completed_at: string;
      proof_line?: string;
    }>;
    reappeared_worktree_paths?: Array<{
      path: string;
      removed_at: string;
      kind: "directory" | "file" | "symlink" | "other";
      contents: Array<string>;
      contents_truncated: boolean;
      entries: number;
      cleanup_blocked_reason?: string;
    }>;
    gate_proof?: {
      status:
        | "honored"
        | "report_only"
        | "missing"
        | "stale"
        | "dirty"
        | "unavailable"
        | "read_failed";
      path?: string;
      recorded?: string;
      head?: string;
      reason?: string;
      proof?: DiscernProofSummary;
      checkpoint_drops?: Array<
        {
          scope: "policy";
          checkpoint: null;
          mode: null;
          policy_commit?: string;
          reason:
            | "merge_base_unresolved"
            | "governing_config_unreadable"
            | "governing_config_invalid"
            | "open_question_store_unreadable"
            | "open_question_store_corrupt"
            | "declaration_evidence_unavailable"
            | "strand_check_unavailable";
          account: string;
        } | {
          scope: "checkpoint";
          checkpoint: string;
          mode: "stop" | "advise";
          policy_commit: string;
          reason:
            | "checkpoint_missing_question"
            | "checkpoint_question_file_missing"
            | "checkpoint_question_file_invalid_path"
            | "checkpoint_question_file_not_regular"
            | "checkpoint_question_file_oversized"
            | "checkpoint_question_file_invalid_utf8"
            | "checkpoint_question_file_unreadable"
            | "checkpoint_question_source_conflict"
            | "checkpoint_selector_conflict"
            | "checkpoint_unknown_scope"
            | "effort_diff_unreadable"
            | "trigger_content_unavailable"
            | "trigger_history_unavailable"
            | "when_spawn_failed"
            | "when_timeout"
            | "when_invalid_exit"
            | "when_cancelled"
            | "when_input_failed"
            | "when_input_cleanup_failed"
            | "when_output_limit"
            | "open_question_store_rebuilt"
            | "subject_unavailable"
            | "open_question_store_write_failed";
          account: string;
        }
      >;
    };
    landed_proof?: {
      commit: string;
      commit_at?: string;
      ref: string;
      proof: DiscernProofSummary;
      issuer?: {
        name?: string;
        email?: string;
        key?: string;
      };
      brief?: string;
    };
    landing_authority?: {
      kind: "authorized" | "conversation-required";
      source?: "conversation" | "standing-grant" | "effort-grant";
      scopes?: Array<string>;
      standing_scopes?: Array<string>;
      uncovered_scopes?: Array<string>;
      uncovered_unscoped_total?: number;
      uncovered_generated_total?: number;
      warnings?: Array<string>;
      uncovered?: Array<{
        path: string;
        scopes: Array<string>;
        generated?: boolean;
      }>;
      uncovered_total?: number;
    };
    fleet?: Array<{
      path: string;
      is_main: boolean;
      is_current: boolean;
      branch: string;
      registration?: {
        head: string;
        locked: boolean;
        prunable: boolean;
      };
      branch_reachable?: boolean;
      filesystem?: {
        state: "directory" | "missing" | "other" | "unreadable";
        reason?: string;
      };
      clean?: boolean;
      changed_files?: number;
      ahead?: number | "unknown";
      behind?: number | "unknown";
      last_activity?: string;
      last_action?: {
        verb: string;
        outcome: "ok" | "failed" | "partial" | "refused";
        at: string;
        failed_stage?: string;
      };
      running?: {
        verb: string;
        started: string;
        elapsed_ms: number;
        typical_duration_ms?: number;
      };
      contained_in?: string;
      git_unavailable?: boolean;
      git_failure?: {
        command: string;
        reason: string;
      };
      id?: string;
      port?: number;
      resources?: {
        [key: string]: string;
      };
      setup?: {
        state: "ready" | "incomplete" | "unavailable";
        marker: "present" | "missing" | "unavailable";
        journal?: {
          status: "missing" | "recorded" | "unavailable";
          path?: string;
          steps: Array<{
            id: string;
            command: string;
            state: "not_started" | "running" | "completed";
          }>;
          reason?: string;
        };
        repair?: {
          kind: "retry" | "manual";
          command: string;
          reason: string;
        };
      };
      task?: {
        id: string;
        branch: string;
        title: string;
        title_source: "recorded" | "identity-fallback" | "unavailable-fallback";
        brief?: string;
        created_from?: {
          ref: string;
          commit: string;
        };
        unavailable_reason?: string;
      };
      broken?: boolean;
      gate_proof?: {
        status:
          | "honored"
          | "report_only"
          | "missing"
          | "stale"
          | "dirty"
          | "unavailable"
          | "read_failed";
        path?: string;
        recorded?: string;
        head?: string;
        reason?: string;
        proof?: DiscernProofSummary;
        checkpoint_drops?: Array<
          {
            scope: "policy";
            checkpoint: null;
            mode: null;
            policy_commit?: string;
            reason:
              | "merge_base_unresolved"
              | "governing_config_unreadable"
              | "governing_config_invalid"
              | "open_question_store_unreadable"
              | "open_question_store_corrupt"
              | "declaration_evidence_unavailable"
              | "strand_check_unavailable";
            account: string;
          } | {
            scope: "checkpoint";
            checkpoint: string;
            mode: "stop" | "advise";
            policy_commit: string;
            reason:
              | "checkpoint_missing_question"
              | "checkpoint_question_file_missing"
              | "checkpoint_question_file_invalid_path"
              | "checkpoint_question_file_not_regular"
              | "checkpoint_question_file_oversized"
              | "checkpoint_question_file_invalid_utf8"
              | "checkpoint_question_file_unreadable"
              | "checkpoint_question_source_conflict"
              | "checkpoint_selector_conflict"
              | "checkpoint_unknown_scope"
              | "effort_diff_unreadable"
              | "trigger_content_unavailable"
              | "trigger_history_unavailable"
              | "when_spawn_failed"
              | "when_timeout"
              | "when_invalid_exit"
              | "when_cancelled"
              | "when_input_failed"
              | "when_input_cleanup_failed"
              | "when_output_limit"
              | "open_question_store_rebuilt"
              | "subject_unavailable"
              | "open_question_store_write_failed";
            account: string;
          }
        >;
      };
      landing_authority?: {
        kind: "authorized" | "conversation-required";
        source?: "conversation" | "standing-grant" | "effort-grant";
        scopes?: Array<string>;
        standing_scopes?: Array<string>;
        uncovered_scopes?: Array<string>;
        uncovered_unscoped_total?: number;
        uncovered_generated_total?: number;
        warnings?: Array<string>;
        uncovered?: Array<{
          path: string;
          scopes: Array<string>;
          generated?: boolean;
        }>;
        uncovered_total?: number;
      };
    }>;
    fleet_total?: number;
    fleet_collisions?: Array<{
      branches: unknown;
      total: number;
    }>;
    adr_collisions?: Array<{
      number: string;
      branches: Array<string>;
    }>;
    projection: {
      mode: "orientation" | "full";
      omitted?: {
        [key: string]: number;
      };
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
    projection: {
      mode: "orientation" | "full";
      omitted?: {
        [key: string]: number;
      };
    };
  };
};

export type DiscernStartResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "start";
  data?: {
    id: string;
    branch: string;
    path: string;
    from: string;
    behind_trunk?: number;
    task: {
      id: string;
      branch: string;
      title: string;
      title_source: "recorded" | "identity-fallback" | "unavailable-fallback";
      brief?: string;
      created_from?: {
        ref: string;
        commit: string;
      };
      unavailable_reason?: string;
    };
    name_note?: string;
    landing_authority?: {
      kind: "authorized" | "conversation-required";
      source?: "conversation" | "standing-grant" | "effort-grant";
      scopes?: Array<string>;
      standing_scopes?: Array<string>;
      uncovered?: Array<{
        path: string;
        scopes: Array<string>;
        generated?: boolean;
      }>;
      uncovered_scopes?: Array<string>;
      uncovered_unscoped_total?: number;
      uncovered_generated_total?: number;
      warnings?: Array<string>;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeRenameResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree rename";
  data?: {
    path: string;
    previous_title: string;
    task: {
      id: string;
      branch: string;
      title: string;
      title_source: "recorded" | "identity-fallback" | "unavailable-fallback";
      brief?: string;
      created_from?: {
        ref: string;
        commit: string;
      };
      unavailable_reason?: string;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeEnsureResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree ensure";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernAcceptResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "accept";
  data?: {
    checkpoint_preparation?: {
      policy?: string;
      outstanding?: Array<{
        id: string;
        mode: "stop" | "advise";
        question: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        matched: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      declared_met?: Array<{
        id: string;
        question?: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        declared_at: string;
        matched?: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      declared_unmet?: Array<{
        id: string;
        question?: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        why: string;
        declared_at: string;
        matched?: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      advise?: Array<{
        id: string;
        mode: "stop" | "advise";
        question: string;
        question_file?: string;
        teach?: string;
        reference?: string;
        matched: Array<string>;
        related?: Array<{
          kind: "similar_existing";
          for_path: string;
          path: string;
        }>;
      }>;
      review?: {
        enforcement: "reported";
        status: "not_needed" | "unreviewed";
        unreviewed?: Array<{
          id: string;
          mode: "stop" | "advise";
          question: string;
          question_file?: string;
          teach?: string;
          reference?: string;
          matched: Array<string>;
          related?: Array<{
            kind: "similar_existing";
            for_path: string;
            path: string;
          }>;
        }>;
      };
      drops?: Array<
        {
          scope: "policy";
          checkpoint: null;
          mode: null;
          policy_commit?: string;
          reason:
            | "merge_base_unresolved"
            | "governing_config_unreadable"
            | "governing_config_invalid"
            | "open_question_store_unreadable"
            | "open_question_store_corrupt"
            | "declaration_evidence_unavailable"
            | "strand_check_unavailable";
          account: string;
        } | {
          scope: "checkpoint";
          checkpoint: string;
          mode: "stop" | "advise";
          policy_commit: string;
          reason:
            | "checkpoint_missing_question"
            | "checkpoint_question_file_missing"
            | "checkpoint_question_file_invalid_path"
            | "checkpoint_question_file_not_regular"
            | "checkpoint_question_file_oversized"
            | "checkpoint_question_file_invalid_utf8"
            | "checkpoint_question_file_unreadable"
            | "checkpoint_question_source_conflict"
            | "checkpoint_selector_conflict"
            | "checkpoint_unknown_scope"
            | "effort_diff_unreadable"
            | "trigger_content_unavailable"
            | "trigger_history_unavailable"
            | "when_spawn_failed"
            | "when_timeout"
            | "when_invalid_exit"
            | "when_cancelled"
            | "when_input_failed"
            | "when_input_cleanup_failed"
            | "when_output_limit"
            | "open_question_store_rebuilt"
            | "subject_unavailable"
            | "open_question_store_write_failed";
          account: string;
        }
      >;
      advisories?: Array<string>;
    };
    emergency_validation?: Array<{
      landing_id: string;
      head: string;
      reason: string;
      exceptions: Array<{
        requirement: {
          id: string;
          kind: "job" | "scope" | "standard";
          definition: string;
        };
        state: "failed" | "unrun" | "stale";
        evidence_id: string | null;
      }>;
      state: "outstanding" | "resolved";
      resolved_by?: {
        candidate_id: string;
        proof_id: string;
      };
      next_action: string;
    }>;
    emergency?: {
      candidate_id?: string;
      candidate?: {
        attempt_id: string;
        source: {
          effort_id: string;
          branch: string;
          head: string;
          tree: string;
        };
        predecessor: string;
        head: string;
        tree: string;
        policy: string;
        requirement_set: string;
      };
      reason?: string;
      exceptions?: Array<{
        requirement: {
          id: string;
          kind: "job" | "scope" | "standard";
          definition: string;
        };
        state: "failed" | "unrun" | "stale";
        evidence_id: string | null;
      }>;
      confirmation?: string;
      preparation?: string;
      expires_at?: number;
      landing_id?: string;
      outcome?: "preview" | "prepared" | "landed" | "not-landed" | "recovery";
      note?: "pending" | "published" | "failed";
      cleanup?: "removed" | "kept" | "failed";
    };
    queue?: Array<DiscernSubmissionRow>;
    root?: string;
    consent?: {
      source: "conversation" | "standing-grant" | "effort-grant";
      scopes?: Array<string>;
    };
    checkpoint_drops?: Array<
      {
        scope: "policy";
        checkpoint: null;
        mode: null;
        policy_commit?: string;
        reason:
          | "merge_base_unresolved"
          | "governing_config_unreadable"
          | "governing_config_invalid"
          | "open_question_store_unreadable"
          | "open_question_store_corrupt"
          | "declaration_evidence_unavailable"
          | "strand_check_unavailable";
        account: string;
      } | {
        scope: "checkpoint";
        checkpoint: string;
        mode: "stop" | "advise";
        policy_commit: string;
        reason:
          | "checkpoint_missing_question"
          | "checkpoint_question_file_missing"
          | "checkpoint_question_file_invalid_path"
          | "checkpoint_question_file_not_regular"
          | "checkpoint_question_file_oversized"
          | "checkpoint_question_file_invalid_utf8"
          | "checkpoint_question_file_unreadable"
          | "checkpoint_question_source_conflict"
          | "checkpoint_selector_conflict"
          | "checkpoint_unknown_scope"
          | "effort_diff_unreadable"
          | "trigger_content_unavailable"
          | "trigger_history_unavailable"
          | "when_spawn_failed"
          | "when_timeout"
          | "when_invalid_exit"
          | "when_cancelled"
          | "when_input_failed"
          | "when_input_cleanup_failed"
          | "when_output_limit"
          | "open_question_store_rebuilt"
          | "subject_unavailable"
          | "open_question_store_write_failed";
        account: string;
      }
    >;
    scopes_changed?: Array<string>;
    landing?: {
      recovery_performed: boolean;
      trunk_landed: boolean;
      worktree_removed: boolean;
      branch_deleted: boolean;
    };
    authority_warnings?: Array<string>;
    proof_line?: string;
    variances?: Array<DiscernAuthorizedVariance>;
    standard_approvals?: Array<{
      standard: string;
      commit: string;
      bound_commit: string;
      measured_commit: string;
      definition_fingerprint: string;
      trunk: string;
      trunk_commit: string;
      direction: "up" | "down";
      trunk_limit: number;
      proposed_limit: number;
      measurement: number;
      delta: number;
      reason: string;
      evidence_paths: Array<string>;
    }>;
    standard_approvals_required?: Array<{
      proposal: {
        standard: string;
        commit: string;
        bound_commit: string;
        measured_commit: string;
        definition_fingerprint: string;
        trunk: string;
        trunk_commit: string;
        direction: "up" | "down";
        trunk_limit: number;
        proposed_limit: number;
        measurement: number;
        delta: number;
        reason: string;
        evidence_paths: Array<string>;
      };
      token: string;
    }>;
    proof_note?: {
      fetch: {
        mode: "local" | "fetch";
        status: "local" | "wired" | "unchanged" | "no_remote" | "failed";
        remotes: Array<string>;
        added: Array<string>;
        removed: Array<string>;
        errors: Array<string>;
      };
      write: {
        status:
          | "recorded"
          | "already_present"
          | "record_failed"
          | "missing_proof";
        ref: string;
        commit: string;
        merged_refs: Array<string>;
        reason?: string;
      };
    };
    ignored_file_changes?: {
      status:
        | "disabled"
        | "baseline_missing"
        | "newer"
        | "unavailable"
        | "unchanged"
        | "changed";
      changed_roots: Array<string>;
      changed_total: number;
      truncated: boolean;
      reason?: string;
    };
    gate_validation?: {
      mode: "proof" | "rerun";
      proof: {
        status:
          | "honored"
          | "report_only"
          | "missing"
          | "stale"
          | "dirty"
          | "unavailable"
          | "read_failed";
        path?: string;
        recorded?: string;
        head?: string;
        reason?: string;
        proof?: DiscernProofSummary;
        checkpoint_drops?: Array<
          {
            scope: "policy";
            checkpoint: null;
            mode: null;
            policy_commit?: string;
            reason:
              | "merge_base_unresolved"
              | "governing_config_unreadable"
              | "governing_config_invalid"
              | "open_question_store_unreadable"
              | "open_question_store_corrupt"
              | "declaration_evidence_unavailable"
              | "strand_check_unavailable";
            account: string;
          } | {
            scope: "checkpoint";
            checkpoint: string;
            mode: "stop" | "advise";
            policy_commit: string;
            reason:
              | "checkpoint_missing_question"
              | "checkpoint_question_file_missing"
              | "checkpoint_question_file_invalid_path"
              | "checkpoint_question_file_not_regular"
              | "checkpoint_question_file_oversized"
              | "checkpoint_question_file_invalid_utf8"
              | "checkpoint_question_file_unreadable"
              | "checkpoint_question_source_conflict"
              | "checkpoint_selector_conflict"
              | "checkpoint_unknown_scope"
              | "effort_diff_unreadable"
              | "trigger_content_unavailable"
              | "trigger_history_unavailable"
              | "when_spawn_failed"
              | "when_timeout"
              | "when_invalid_exit"
              | "when_cancelled"
              | "when_input_failed"
              | "when_input_cleanup_failed"
              | "when_output_limit"
              | "open_question_store_rebuilt"
              | "subject_unavailable"
              | "open_question_store_write_failed";
            account: string;
          }
        >;
      };
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernUpdateResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "update";
  data?: {
    behind: number;
    fast_forward: boolean;
    commits: Array<{
      sha: string;
      subject: string;
    }>;
    commits_total: number;
    commits_truncated: boolean;
    files: Array<{
      path: string;
      status: string;
      added: number | null;
      removed: number | null;
    }>;
    files_total: number;
    files_truncated: boolean;
    overlap: Array<string>;
    overlap_total: number;
    scopes_incoming: Array<string>;
    auto_resolved?: Array<string>;
    regenerated?: Array<string>;
    range: {
      base: string;
      before: string;
      main: string;
      after?: string;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernIdentityResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "identity";
  data?: {
    kind: "field";
    field: "id" | "site" | "branch" | "port" | "db" | "seed" | "worktree";
    value: string;
  } | {
    kind: "resource";
    name: string;
    value: string;
  } | {
    kind: "resources";
    resources: {
      [key: string]: string;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernScriptsResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "scripts";
  data?: {
    scripts: Array<{
      name: string;
      description?: string;
    }>;
    directory: string;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeSetupResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree setup";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeTeardownResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree teardown";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeDropResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree drop";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreeParkResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree park";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernWorktreePruneResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "worktree prune";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSkillsResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "skills";
  data?: {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSkillsListResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "skills list";
  data?: {
    skills: Array<{
      name: string;
      source: "authored" | "bundled";
      overrides_bundled: boolean;
      has_bundled: boolean;
      excluded: boolean;
    }>;
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernSkillsEjectResult = DiscernResultState & {
  ok: boolean;
  dry_run?: boolean;
  plan?: {
    title: string;
    details: Array<string>;
    steps: Array<{
      kind:
        | "job"
        | "scope-gate"
        | "merge-check"
        | "standards-limits-check"
        | "tracked-artifacts-check"
        | "instructions-check"
        | "skills-check"
        | "tracked-refresh-check"
        | "resource-create"
        | "resource-destroy"
        | "git"
        | "task-metadata"
        | "setup-step"
        | "repository-ensure"
        | "checkout-clean-check"
        | "setup-ensure"
        | "env"
        | "refresh"
        | "tidy"
        | "standard";
      label: string;
      disposition: "run" | "skip" | "gate";
      note?: string;
      group?: string;
    }>;
  };
  steps?: Array<{
    kind:
      | "job"
      | "scope-gate"
      | "merge-check"
      | "standards-limits-check"
      | "tracked-artifacts-check"
      | "instructions-check"
      | "skills-check"
      | "tracked-refresh-check"
      | "resource-create"
      | "resource-destroy"
      | "git"
      | "task-metadata"
      | "setup-step"
      | "repository-ensure"
      | "checkout-clean-check"
      | "setup-ensure"
      | "env"
      | "refresh"
      | "tidy"
      | "standard";
    label: string;
    disposition: "run" | "skip" | "gate";
    note?: string;
    group?: string;
    outcome: "ok" | "failed" | "skipped" | "cancelled";
    advisory?: {
      kind:
        | "acceptance-cleanup-incomplete"
        | "checkpoint-evidence-dropped"
        | "checkout-clean-observation-unavailable"
        | "doctor-warning"
        | "execution-cap-unavailable"
        | "generated-attribute-pattern-untranslated"
        | "ignored-file-observation-unavailable"
        | "landing-authority-unverified"
        | "optional-resource-unavailable"
        | "proof-recording-unavailable"
        | "setup-unproven-completion"
        | "setup-machinery-commit-failed"
        | "setup-marker-commit-failed"
        | "standards-limits-unverified"
        | "uninstall-strip-incomplete";
      evidence: Array<string>;
      next_action: string;
    };
    duration_s?: number;
    output_path?: string;
    output_lines?: number;
    error_like_lines?: number;
  }>;
  waited_ms?: number;
  diagnostics?: Array<{
    tool: string;
    severity: "error" | "warning";
    message: string;
    reproduce_cmd: string;
    output?: string;
    truncated?: boolean;
    output_path?: string;
    file?: string;
    line?: number;
    col?: number;
    rule?: string;
    fix_available?: boolean;
  }>;
  diagnostic_evidence?: {
    path: string;
    digest: string;
    bytes: number;
    total: number;
    shown: number;
    repeats: Array<number>;
  };
  hints?: Array<string>;
  advisories?: Array<{
    kind:
      | "acceptance-cleanup-incomplete"
      | "checkpoint-evidence-dropped"
      | "checkout-clean-observation-unavailable"
      | "doctor-warning"
      | "execution-cap-unavailable"
      | "generated-attribute-pattern-untranslated"
      | "ignored-file-observation-unavailable"
      | "landing-authority-unverified"
      | "optional-resource-unavailable"
      | "proof-recording-unavailable"
      | "setup-unproven-completion"
      | "setup-machinery-commit-failed"
      | "setup-marker-commit-failed"
      | "standards-limits-unverified"
      | "uninstall-strip-incomplete";
    evidence: Array<string>;
    next_action: string;
  }>;
  error?: string;
  message?: string;
  verb: "skills eject";
  data?: {
    name: string;
    dest_abs: string;
    dest_rel: string;
    skills_dir_persisted: boolean;
    materialized: {
      copied: number;
      linked: number;
      pruned: number;
      errors: Array<string>;
    };
  } | {
    issues: Array<{
      kind?: "unknown_root_section";
      path: string;
      message: string;
    }>;
  };
};

export type DiscernCliJsonResult =
  | DiscernRootResult
  | DiscernSetupResult
  | DiscernSetupBeginResult
  | DiscernSetupVerifyResult
  | DiscernSetupStepResult
  | DiscernSetupDoneResult
  | DiscernSetupAcceptResult
  | DiscernUpgradeResult
  | DiscernUninstallResult
  | DiscernDoctorResult
  | DiscernLicensesResult
  | DiscernTriangleResult
  | DiscernMapResult
  | DiscernDocsResult
  | DiscernHelpResult
  | DiscernConfigResult
  | DiscernDoneResult
  | DiscernPrepareResult
  | DiscernTestResult
  | DiscernImprovementResult
  | DiscernCheckpointsResult
  | DiscernProgressResult
  | DiscernStandardsResult
  | DiscernStandardsProposeResult
  | DiscernRefreshResult
  | DiscernTidyResult
  | DiscernImpactResult
  | DiscernCouplingResult
  | DiscernAwaitResult
  | DiscernPatternsResult
  | DiscernPatternsResetResult
  | DiscernPatternsSealResult
  | DiscernPatternsArchivesResult
  | DiscernDeskResult
  | DiscernEnterResult
  | DiscernStatusResult
  | DiscernStartResult
  | DiscernWorktreeRenameResult
  | DiscernWorktreeEnsureResult
  | DiscernAcceptResult
  | DiscernUpdateResult
  | DiscernIdentityResult
  | DiscernScriptsResult
  | DiscernWorktreeResult
  | DiscernWorktreeSetupResult
  | DiscernWorktreeTeardownResult
  | DiscernWorktreeDropResult
  | DiscernWorktreeParkResult
  | DiscernWorktreePruneResult
  | DiscernSkillsResult
  | DiscernSkillsListResult
  | DiscernSkillsEjectResult;

export interface DiscernResultByVerb {
  discern: DiscernRootResult;
  setup: DiscernSetupResult;
  "setup begin": DiscernSetupBeginResult;
  "setup verify": DiscernSetupVerifyResult;
  "setup step": DiscernSetupStepResult;
  "setup done": DiscernSetupDoneResult;
  "setup accept": DiscernSetupAcceptResult;
  upgrade: DiscernUpgradeResult;
  uninstall: DiscernUninstallResult;
  doctor: DiscernDoctorResult;
  licenses: DiscernLicensesResult;
  triangle: DiscernTriangleResult;
  map: DiscernMapResult;
  docs: DiscernDocsResult;
  help: DiscernHelpResult;
  config: DiscernConfigResult;
  done: DiscernDoneResult;
  prepare: DiscernPrepareResult;
  test: DiscernTestResult;
  improvement: DiscernImprovementResult;
  checkpoints: DiscernCheckpointsResult;
  progress: DiscernProgressResult;
  standards: DiscernStandardsResult;
  "standards propose": DiscernStandardsProposeResult;
  refresh: DiscernRefreshResult;
  tidy: DiscernTidyResult;
  impact: DiscernImpactResult;
  coupling: DiscernCouplingResult;
  await: DiscernAwaitResult;
  patterns: DiscernPatternsResult;
  "patterns reset": DiscernPatternsResetResult;
  "patterns seal": DiscernPatternsSealResult;
  "patterns archives": DiscernPatternsArchivesResult;
  desk: DiscernDeskResult;
  enter: DiscernEnterResult;
  status: DiscernStatusResult;
  start: DiscernStartResult;
  "worktree rename": DiscernWorktreeRenameResult;
  "worktree ensure": DiscernWorktreeEnsureResult;
  accept: DiscernAcceptResult;
  update: DiscernUpdateResult;
  identity: DiscernIdentityResult;
  scripts: DiscernScriptsResult;
  worktree: DiscernWorktreeResult;
  "worktree setup": DiscernWorktreeSetupResult;
  "worktree teardown": DiscernWorktreeTeardownResult;
  "worktree drop": DiscernWorktreeDropResult;
  "worktree park": DiscernWorktreeParkResult;
  "worktree prune": DiscernWorktreePruneResult;
  skills: DiscernSkillsResult;
  "skills list": DiscernSkillsListResult;
  "skills eject": DiscernSkillsEjectResult;
}

export interface DiscernResultByCommand {
  discern: DiscernRootResult;
  setup: DiscernSetupResult;
  "setup begin": DiscernSetupBeginResult;
  "setup verify": DiscernSetupVerifyResult;
  "setup step": DiscernSetupStepResult;
  "setup done": DiscernSetupDoneResult;
  "setup accept": DiscernSetupAcceptResult;
  upgrade: DiscernUpgradeResult;
  uninstall: DiscernUninstallResult;
  doctor: DiscernDoctorResult;
  licenses: DiscernLicensesResult;
  triangle: DiscernTriangleResult;
  map: DiscernMapResult;
  docs: DiscernDocsResult;
  help: DiscernHelpResult;
  config: DiscernConfigResult;
  "config set-job": DiscernConfigResult;
  "config set-scope": DiscernConfigResult;
  "config set-standard": DiscernConfigResult;
  "config set": DiscernConfigResult;
  "config get": DiscernConfigResult;
  "config array": DiscernConfigResult;
  "config has": DiscernConfigResult;
  "config subsections": DiscernConfigResult;
  "config keys": DiscernConfigResult;
  "config explain": DiscernConfigResult;
  done: DiscernDoneResult;
  prepare: DiscernPrepareResult;
  test: DiscernTestResult;
  improvement: DiscernImprovementResult;
  checkpoints: DiscernCheckpointsResult;
  progress: DiscernProgressResult;
  standards: DiscernStandardsResult;
  "standards propose": DiscernStandardsProposeResult;
  refresh: DiscernRefreshResult;
  tidy: DiscernTidyResult;
  impact: DiscernImpactResult;
  coupling: DiscernCouplingResult;
  await: DiscernAwaitResult;
  patterns: DiscernPatternsResult;
  "patterns reset": DiscernPatternsResetResult;
  "patterns seal": DiscernPatternsSealResult;
  "patterns archives": DiscernPatternsArchivesResult;
  desk: DiscernDeskResult;
  enter: DiscernEnterResult;
  status: DiscernStatusResult;
  start: DiscernStartResult;
  "worktree rename": DiscernWorktreeRenameResult;
  "worktree ensure": DiscernWorktreeEnsureResult;
  accept: DiscernAcceptResult;
  update: DiscernUpdateResult;
  identity: DiscernIdentityResult;
  scripts: DiscernScriptsResult;
  worktree: DiscernWorktreeResult;
  "worktree setup": DiscernWorktreeSetupResult;
  "worktree teardown": DiscernWorktreeTeardownResult;
  "worktree drop": DiscernWorktreeDropResult;
  "worktree park": DiscernWorktreeParkResult;
  "worktree prune": DiscernWorktreePruneResult;
  skills: DiscernSkillsResult;
  "skills list": DiscernSkillsListResult;
  "skills eject": DiscernSkillsEjectResult;
}

export interface DiscernMcpTextContent {
  type: "text";
  /** An independently sufficient, contract-authored Markdown projection. */
  text: string;
}

export interface DiscernMcpToolResult<TStructuredContent> {
  /** Authored Markdown for text-only and model-facing hosts. */
  content: DiscernMcpTextContent[];
  /** Compact structured data for structured-first hosts and integrations. */
  structuredContent: TStructuredContent;
  isError: boolean;
}

export interface DiscernMcpStructuredContentByTool {
  discern_doctor: DiscernDoctorResult;
  discern_map: DiscernMapResult;
  discern_docs: DiscernDocsResult;
  discern_done: DiscernDoneResult;
  discern_prepare: DiscernPrepareResult;
  discern_test: DiscernTestResult;
  discern_improvement: DiscernImprovementResult;
  discern_checkpoints: DiscernCheckpointsResult;
  discern_progress: DiscernProgressResult;
  discern_standards: DiscernStandardsResult;
  discern_standards_propose: DiscernStandardsProposeResult;
  discern_refresh: DiscernRefreshResult;
  discern_impact: DiscernImpactResult;
  discern_coupling: DiscernCouplingResult;
  discern_await: DiscernAwaitResult;
  discern_patterns: DiscernPatternsResult;
  discern_status: DiscernStatusResult;
  discern_start: DiscernStartResult;
  discern_accept: DiscernAcceptResult;
  discern_update: DiscernUpdateResult;
}

export interface DiscernMcpToolResultByTool {
  discern_doctor: DiscernMcpToolResult<DiscernDoctorResult>;
  discern_map: DiscernMcpToolResult<DiscernMapResult>;
  discern_docs: DiscernMcpToolResult<DiscernDocsResult>;
  discern_done: DiscernMcpToolResult<DiscernDoneResult>;
  discern_prepare: DiscernMcpToolResult<DiscernPrepareResult>;
  discern_test: DiscernMcpToolResult<DiscernTestResult>;
  discern_improvement: DiscernMcpToolResult<DiscernImprovementResult>;
  discern_checkpoints: DiscernMcpToolResult<DiscernCheckpointsResult>;
  discern_progress: DiscernMcpToolResult<DiscernProgressResult>;
  discern_standards: DiscernMcpToolResult<DiscernStandardsResult>;
  discern_standards_propose: DiscernMcpToolResult<
    DiscernStandardsProposeResult
  >;
  discern_refresh: DiscernMcpToolResult<DiscernRefreshResult>;
  discern_impact: DiscernMcpToolResult<DiscernImpactResult>;
  discern_coupling: DiscernMcpToolResult<DiscernCouplingResult>;
  discern_await: DiscernMcpToolResult<DiscernAwaitResult>;
  discern_patterns: DiscernMcpToolResult<DiscernPatternsResult>;
  discern_status: DiscernMcpToolResult<DiscernStatusResult>;
  discern_start: DiscernMcpToolResult<DiscernStartResult>;
  discern_accept: DiscernMcpToolResult<DiscernAcceptResult>;
  discern_update: DiscernMcpToolResult<DiscernUpdateResult>;
}

export type DiscernMcpStructuredContent =
  | DiscernDoctorResult
  | DiscernMapResult
  | DiscernDocsResult
  | DiscernDoneResult
  | DiscernPrepareResult
  | DiscernTestResult
  | DiscernImprovementResult
  | DiscernCheckpointsResult
  | DiscernProgressResult
  | DiscernStandardsResult
  | DiscernStandardsProposeResult
  | DiscernRefreshResult
  | DiscernImpactResult
  | DiscernCouplingResult
  | DiscernAwaitResult
  | DiscernPatternsResult
  | DiscernStatusResult
  | DiscernStartResult
  | DiscernAcceptResult
  | DiscernUpdateResult;

export type DiscernMcpJsonResult =
  | DiscernDoctorMcpToolResult
  | DiscernMapMcpToolResult
  | DiscernDocsMcpToolResult
  | DiscernDoneMcpToolResult
  | DiscernPrepareMcpToolResult
  | DiscernTestMcpToolResult
  | DiscernImprovementMcpToolResult
  | DiscernCheckpointsMcpToolResult
  | DiscernProgressMcpToolResult
  | DiscernStandardsMcpToolResult
  | DiscernStandardsProposeMcpToolResult
  | DiscernRefreshMcpToolResult
  | DiscernImpactMcpToolResult
  | DiscernCouplingMcpToolResult
  | DiscernAwaitMcpToolResult
  | DiscernPatternsMcpToolResult
  | DiscernStatusMcpToolResult
  | DiscernStartMcpToolResult
  | DiscernAcceptMcpToolResult
  | DiscernUpdateMcpToolResult;

export type DiscernDoctorMcpToolResult = DiscernMcpToolResult<
  DiscernDoctorResult
>;

export type DiscernMapMcpToolResult = DiscernMcpToolResult<DiscernMapResult>;

export type DiscernDocsMcpToolResult = DiscernMcpToolResult<DiscernDocsResult>;

export type DiscernDoneMcpToolResult = DiscernMcpToolResult<DiscernDoneResult>;

export type DiscernPrepareMcpToolResult = DiscernMcpToolResult<
  DiscernPrepareResult
>;

export type DiscernTestMcpToolResult = DiscernMcpToolResult<DiscernTestResult>;

export type DiscernImprovementMcpToolResult = DiscernMcpToolResult<
  DiscernImprovementResult
>;

export type DiscernCheckpointsMcpToolResult = DiscernMcpToolResult<
  DiscernCheckpointsResult
>;

export type DiscernProgressMcpToolResult = DiscernMcpToolResult<
  DiscernProgressResult
>;

export type DiscernStandardsMcpToolResult = DiscernMcpToolResult<
  DiscernStandardsResult
>;

export type DiscernStandardsProposeMcpToolResult = DiscernMcpToolResult<
  DiscernStandardsProposeResult
>;

export type DiscernRefreshMcpToolResult = DiscernMcpToolResult<
  DiscernRefreshResult
>;

export type DiscernImpactMcpToolResult = DiscernMcpToolResult<
  DiscernImpactResult
>;

export type DiscernCouplingMcpToolResult = DiscernMcpToolResult<
  DiscernCouplingResult
>;

export type DiscernAwaitMcpToolResult = DiscernMcpToolResult<
  DiscernAwaitResult
>;

export type DiscernPatternsMcpToolResult = DiscernMcpToolResult<
  DiscernPatternsResult
>;

export type DiscernStatusMcpToolResult = DiscernMcpToolResult<
  DiscernStatusResult
>;

export type DiscernStartMcpToolResult = DiscernMcpToolResult<
  DiscernStartResult
>;

export type DiscernAcceptMcpToolResult = DiscernMcpToolResult<
  DiscernAcceptResult
>;

export type DiscernUpdateMcpToolResult = DiscernMcpToolResult<
  DiscernUpdateResult
>;
