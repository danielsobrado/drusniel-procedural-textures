import { describe, expect, it } from 'vitest';
import { canReparentGroup } from '../src/materials/GroupHierarchy';
import type { MaterialGroup } from '../src/materials/types';

function group(id: string, parentId: string | null): MaterialGroup {
  return { id, name: id, parentId, enabled: true, opacity: 1 };
}

describe('group hierarchy reparenting', () => {
  it('rejects cycles through descendants', () => {
    const groups = [group('root', null), group('child', 'root'), group('leaf', 'child')];
    expect(canReparentGroup('root', 'leaf', groups, 4)).toBe(false);
  });

  it('rejects a parent that would push descendants beyond the configured depth', () => {
    const groups = [
      group('a', null),
      group('b', 'a'),
      group('c', 'b'),
      group('move', null),
      group('move-child', 'move')
    ];
    expect(canReparentGroup('move', 'c', groups, 3)).toBe(false);
    expect(canReparentGroup('move', 'b', groups, 3)).toBe(true);
  });

  it('allows a valid shallower parent', () => {
    const groups = [group('a', null), group('b', 'a'), group('move', null)];
    expect(canReparentGroup('move', 'b', groups, 4)).toBe(true);
  });
});
