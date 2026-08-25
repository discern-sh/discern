/** Public operation kinds emitted while upgrade reconciles `discern.toml`. */
export const CONFIG_RECONCILE_OPERATION_KINDS = [
  "section",
  "key",
  "banner",
  "marker",
] as const;

/** One member of the config-reconciliation operation vocabulary. */
export type ConfigReconcileOperationKind =
  (typeof CONFIG_RECONCILE_OPERATION_KINDS)[number];
