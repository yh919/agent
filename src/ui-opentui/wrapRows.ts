// Expand logical chat rows into physical terminal rows by wrapping at
// `width` cells. ChatPane used to count one logical line as one viewport
// slot while OpenTUI's text compositor still soft-wrapped long lines to
// multiple physical rows — that desynced the scroll window from what the
// user actually saw. Wrapping here means the JS slice and the paint agree.
//
// Hang indent: when a row wraps, continuation physical lines are padded
// with `hangIndent` spaces so prose/tool bodies stay column-aligned under
// the role prefix (› / ⏺ / ⎿ / │), not flush-left under the glyph.
//
// Measurement is character-count (not east-asian fullwidth / emoji width):
// tool output and assistant prose are overwhelmingly ASCII.

import { cellWidth, graphemes } from '../ui/terminalWidth.js';
import type { AnsiSpan } from './ansiSpans.js';

export interface WrappableRow {
  key: string;
  spans: AnsiSpan[];
  baseColor: string;
  baseDim: boolean;
  /** Spaces to prepend on every physical line after the first (prefix width). */
  hangIndent?: number;
  /** Optional payload preserved across wrap (e.g. click-to-expand source). */
  sourceEntry?: unknown;
}

/**
 * Word-aware break points over `plain`: [start, end) per physical line, in
 * string indices. Breaks after the last space that fits (the space is
 * dropped); a word longer than the line is hard-split. '\n' always breaks.
 */
export function wrapSegments(plain: string, first: number, rest: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let budget = first;
  let lineStart = 0;
  let col = 0;
  let lastSpaceEnd = -1; // index just past the last space on this line
  let i = 0;
  const push = (end: number, next: number) => {
    segs.push([lineStart, end]);
    lineStart = next;
    col = 0;
    lastSpaceEnd = -1;
    budget = rest;
  };
  while (i < plain.length) {
    if (plain[i] === '\n') {
      push(i, i + 1);
      i += 1;
      continue;
    }
    const g = graphemes(plain.slice(i, i + 8))[0] ?? plain[i] ?? '';
    const gw = cellWidth(g);
    if (col + gw > budget && col > 0) {
      if (g === ' ') {
        push(i, i + 1); // break on this space, drop it
        i += 1;
        continue;
      }
      // Re-flow only when the partial word would fit on a fresh line;
      // otherwise moving it just strands the head (e.g. a lone "⏺").
      const wordEnd = plain.slice(lastSpaceEnd).search(/[ \n]/);
      const wordLen = cellWidth(
        plain.slice(lastSpaceEnd, wordEnd < 0 ? undefined : lastSpaceEnd + wordEnd),
      );
      if (lastSpaceEnd > lineStart && wordLen <= rest) {
        // Re-flow the partial word onto the next line.
        push(lastSpaceEnd - 1, lastSpaceEnd);
        i = lineStart;
        continue;
      }
      push(i, i); // single word wider than the line: hard split
      continue;
    }
    col += gw;
    i += g.length;
    if (g === ' ') lastSpaceEnd = i;
  }
  segs.push([lineStart, plain.length]);
  return segs;
}

/** Split one logical row into one-or-more physical rows of at most `width`. */
export function wrapRowToWidth(row: WrappableRow, width: number): WrappableRow[] {
  const w = Math.max(1, width);
  const hang = Math.max(0, Math.min(row.hangIndent ?? 0, w - 1));
  const plain = row.spans.map((s) => s.text).join('');
  if (plain.length === 0) return [row];
  if (!plain.includes('\n') && cellWidth(plain) <= w) return [row];

  // Span start offsets in `plain`, to slice styled pieces per segment.
  const starts: number[] = [];
  let off = 0;
  for (const sp of row.spans) {
    starts.push(off);
    off += sp.text.length;
  }

  return wrapSegments(plain, w, Math.max(1, w - hang)).map(([from, to], part) => {
    const spans: AnsiSpan[] = [];
    row.spans.forEach((sp, k) => {
      const s0 = Math.max(from, starts[k] ?? 0);
      const s1 = Math.min(to, (starts[k] ?? 0) + sp.text.length);
      if (s1 > s0)
        spans.push({ ...sp, text: sp.text.slice(s0 - (starts[k] ?? 0), s1 - (starts[k] ?? 0)) });
    });
    if (spans.length === 0) spans.push({ text: '' });
    // Hang-indent continuation lines so wrapped content lines up under the
    // role prefix, not under the left margin.
    if (part > 0 && hang > 0) spans.unshift({ text: ' '.repeat(hang) });
    return {
      key: `${row.key}-w${part}`,
      spans,
      baseColor: row.baseColor,
      baseDim: row.baseDim,
      hangIndent: row.hangIndent,
      // Only the first physical line of a collapsible entry is clickable.
      sourceEntry: part === 0 ? row.sourceEntry : undefined,
    };
  });
}

/** Expand every logical row; total length is the physical viewport budget. */
export function wrapRowsToWidth(rows: WrappableRow[], width: number): WrappableRow[] {
  const out: WrappableRow[] = [];
  for (const row of rows) {
    out.push(...wrapRowToWidth(row, width));
  }
  return out;
}
