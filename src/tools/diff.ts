// Line diff for permission cards: "- removed", "+ added", "  context",
// with long unchanged runs folded to "  …". LCS over lines.

/** ponytail: O(n·m) LCS table; above MAX_CELLS we skip diffing (caller shows content). */
const MAX_CELLS = 2_000_000;

export function lineDiff(before: string, after: string, context = 3): string[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_CELLS) return null;

  // lcs[i*W + j] = LCS length of a[i:], b[j:] (flat table, W = b.length + 1)
  const W = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * W);
  const at = (i: number, j: number) => lcs[i * W + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * W + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const ops: Array<[' ' | '-' | '+', string]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push([' ', a[i] ?? '']);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ops.push(['-', a[i] ?? '']);
      i += 1;
    } else {
      ops.push(['+', b[j] ?? '']);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) ops.push(['-', a[i] ?? '']);
  for (; j < b.length; j += 1) ops.push(['+', b[j] ?? '']);

  // Keep `context` unchanged lines around each change; fold the rest.
  const near = ops.map((_, k) =>
    ops.slice(Math.max(0, k - context), k + context + 1).some(([op]) => op !== ' '),
  );
  const out: string[] = [];
  ops.forEach(([op, line], k) => {
    if (near[k]) out.push(`${op} ${line}`);
    else if (out.at(-1) !== '  …') out.push('  …');
  });
  return out;
}
