/** Public queue decisions share one vocabulary across adapters and result schemas. */
import { z } from "@zod/zod";
export const QueueControlSchema = z.enum([
  "hold",
  "resume",
  "withdraw",
  "revoke",
  "reprioritize",
]);
export type QueueControl = z.infer<typeof QueueControlSchema>;
