import { describe, expect, it } from 'vitest';
import { lineDiff } from './diff.js';

describe('lineDiff', () => {
  it('marks changed lines and folds far-away context', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i'].join('\n');
    expect(lineDiff(before, after, 1)).toEqual(['  …', '  d', '- e', '+ E', '  f', '  …']);
  });
  it('shows pure additions and refuses huge inputs', () => {
    expect(lineDiff('x', 'x\ny')).toEqual(['  x', '+ y']);
    const big = Array.from({ length: 2000 }, (_, k) => String(k)).join('\n');
    expect(lineDiff(big, `${big}\nz`)).toBeNull();
  });
});
