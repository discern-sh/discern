/** Checkout diagnostics preserve literal path evidence without inventing a writer. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkoutChangesMessage } from "../src/shared/checkout_changes.ts";

Deno.test("checkout diagnostics retain rename origins and escape unusual names", () => {
  const old = "old\nname.ts";
  const changed = 'new "name.ts';
  const message = checkoutChangesMessage(`R  ${changed}\0${old}\0?? ${old}\0`);
  assertStringIncludes(message, JSON.stringify(old));
  assertStringIncludes(message, JSON.stringify(changed));
  assertEquals(message.includes("\n"), false);
  assertEquals(message.split(JSON.stringify(old)).length, 2);
  assertStringIncludes(message, "git status --short");
  assert(!message.includes("producer") && !message.includes("test job"));
});

Deno.test("checkout diagnostics bound large change sets without hiding the remainder", () => {
  const message = checkoutChangesMessage(
    Array.from(
      { length: 21 },
      (_, index) => `?? future/${String(index).padStart(2, "0")}\0`,
    ).join(""),
  );
  assertStringIncludes(message, '"future/00"');
  assertStringIncludes(message, '"future/09"');
  assertStringIncludes(message, "(+11 more)");
  assert(!message.includes('"future/10"'));
});
