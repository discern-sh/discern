/** Count physical Git administration requests during one isolated operation. */
export async function countedAdminQueries<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T; readonly queries: number }> {
  const Command = Deno.Command;
  let queries = 0;
  Deno.Command = class extends Command {
    /** Count the administration query while retaining the native command. */
    constructor(command: string | URL, options?: Deno.CommandOptions) {
      super(command, options);
      if (options?.args?.includes("--git-common-dir")) queries += 1;
    }
  };
  try {
    return { value: await operation(), queries };
  } finally {
    Deno.Command = Command;
  }
}

/** Count every git process the engine constructs during `operation`. */
export async function countedGitSpawns<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T; readonly spawns: number }> {
  const Command = Deno.Command;
  let spawns = 0;
  Deno.Command = class extends Command {
    /** Count the spawn while retaining the native command. */
    constructor(command: string | URL, options?: Deno.CommandOptions) {
      super(command, options);
      spawns += 1;
    }
  };
  try {
    return { value: await operation(), spawns };
  } finally {
    Deno.Command = Command;
  }
}
