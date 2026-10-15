import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn (clsx + tailwind-merge)', () => {
  it('joins conditional classes', () => {
    const hidden = false;
    expect(cn('a', hidden && 'b', 'c')).toBe('a c');
  });

  it('lets later utilities win on conflicts (v3 behavior)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
  });

  it('keeps non-conflicting classes from different groups', () => {
    const result = cn('flex items-center px-2 text-sm', 'hover:px-4');
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('px-2');
    expect(result).toContain('text-sm');
    expect(result).toContain('hover:px-4');
  });
});
