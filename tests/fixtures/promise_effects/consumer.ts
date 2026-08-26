import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import {
  genericEffect,
  overloadedEffect,
  promisedEffect,
  syncEffect,
  thenableEffect,
  unionEffect,
} from "./imported.ts";

declare function consume(value: PromiseLike<unknown>): void;

syncEffect();
join("a", "b");
promisedEffect();
thenableEffect();
unionEffect();
overloadedEffect("async");
overloadedEffect("sync");
genericEffect(Promise.resolve(1));
genericEffect(1);
ensureDir("fixture");
void promisedEffect();
await promisedEffect();
const held = promisedEffect();
consume(held);
let assigned: Promise<number>;
assigned = promisedEffect();
consume(assigned);

export function returnedEffect(): Promise<number> {
  return promisedEffect();
}
