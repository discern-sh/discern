/** A registered environment variable whose value its reader cannot accept. */
export class EnvironmentValueError extends Error {
  /**
   * @param variable The registered variable's name.
   * @param value The value found in the environment.
   * @param message The complete refusal: what the value is, what ran, and how to correct it.
   */
  constructor(
    readonly variable: string,
    readonly value: string,
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentValueError";
  }
}
