/** A file above the bounded-capture ceiling with text at both ends of a zero run. */
export async function writeLargeInput(
  path: string,
  size: number,
): Promise<void> {
  const head = new TextEncoder().encode("head line\n");
  const tail = new TextEncoder().encode(" tail\n");
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await file.write(head);
    await file.truncate(size);
    await file.seek(size - tail.length, Deno.SeekMode.Start);
    await file.write(tail);
  } finally {
    file.close();
  }
}
