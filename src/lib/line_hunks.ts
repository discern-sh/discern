/**
 * Line alignment for explaining what replacing one text with another loses.
 * Pure and dependency-free: callers decide what a hunk means.
 */

/** One run of lines the two sides do not share, at the same aligned position. */
export interface LineHunk {
  /** Lines only the `before` side holds here. */
  readonly removed: readonly string[];
  /** Lines only the `after` side holds here. */
  readonly added: readonly string[];
}

/** Line-pair budget for the alignment table. Past it, the differing middle is
 * reported as one hunk that adds every `after` line and removes nothing. */
export const LINE_HUNK_ALIGNMENT_BUDGET = 4_000_000;

/**
 * Align two line lists by longest common subsequence and return each run of
 * unshared lines in order. Common leading and trailing lines are matched first,
 * so the table covers only the differing middle.
 */
export function lineHunks(
  before: readonly string[],
  after: readonly string[],
  budget: number = LINE_HUNK_ALIGNMENT_BUDGET,
): LineHunk[] {
  let start = 0;
  while (
    start < before.length && start < after.length &&
    before[start] === after[start]
  ) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start && endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if (a.length === 0 || b.length === 0) {
    return a.length + b.length === 0 ? [] : [{ removed: a, added: b }];
  }
  if (a.length * b.length > budget) return [{ removed: [], added: b }];

  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => common[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] = a[i] === b[j]
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const hunks: LineHunk[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = (): void => {
    if (removed.length + added.length > 0) hunks.push({ removed, added });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && right !== undefined && left === right) {
      flush();
      i++;
      j++;
    } else if (
      left !== undefined &&
      (right === undefined || at(i + 1, j) >= at(i, j + 1))
    ) {
      removed.push(left);
      i++;
    } else if (right !== undefined) {
      added.push(right);
      j++;
    }
  }
  flush();
  return hunks;
}
