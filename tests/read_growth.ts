/** Make the next read of `path` observe an append, to exercise changed-while-read refusals. */
export async function growOnNextRead(
  path: string,
  growth: string,
): Promise<() => void> {
  const target = (await Deno.stat(path)).ino;
  const read = Deno.FsFile.prototype.read;
  let grown = false;
  Deno.FsFile.prototype.read = async function (
    this: Deno.FsFile,
    buffer: Uint8Array,
  ): Promise<number | null> {
    if (!grown && (await this.stat()).ino === target) {
      grown = true;
      await Deno.writeTextFile(path, growth, { append: true });
    }
    return await read.call(this, buffer);
  };
  return (): void => {
    Deno.FsFile.prototype.read = read;
  };
}
