/** Host-created filesystem entries that are not authored project content. */
const HOST_METADATA_PATH =
  /(?:^|[/\\])(?:\._[^/\\]*|\$recycle\.bin|\.(?:apdisk|appledouble|ds_store|fseventsd|lsoverride|spotlight-v100|temporaryitems|trashes)|desktop\.ini|ehthumbs(?:_vista)?\.db|icon\r|thumbs\.db(?::encryptable)?)(?:[/\\]|$)/i;

/** Whether any segment of `path` is known macOS or Windows metadata. */
export function isHostMetadataPath(path: string): boolean {
  return HOST_METADATA_PATH.test(path);
}
