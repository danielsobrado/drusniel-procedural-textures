import type { MaterialGroup } from './types';

function candidateDepth(
  groupId: string,
  candidateId: string,
  byId: ReadonlyMap<string, MaterialGroup>
): number | null {
  let depth = 0;
  let currentId: string | null = candidateId;
  const visited = new Set<string>();

  while (currentId !== null) {
    if (currentId === groupId || visited.has(currentId)) return null;
    visited.add(currentId);
    const current = byId.get(currentId);
    if (current === undefined) return null;
    currentId = current.parentId;
    if (currentId !== null) depth += 1;
  }

  return depth;
}

function descendantDepth(groupId: string, groups: readonly MaterialGroup[]): number | null {
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (group.parentId === null) continue;
    const values = children.get(group.parentId) ?? [];
    values.push(group.id);
    children.set(group.parentId, values);
  }

  let maximum = 0;
  const pending: Array<{ id: string; depth: number }> = [{ id: groupId, depth: 0 }];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current.id)) return null;
    visited.add(current.id);
    maximum = Math.max(maximum, current.depth);
    for (const childId of children.get(current.id) ?? []) {
      pending.push({ id: childId, depth: current.depth + 1 });
    }
  }
  return maximum;
}

export function canReparentGroup(
  groupId: string,
  candidateId: string,
  groups: readonly MaterialGroup[],
  maxDepth: number
): boolean {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || groupId === candidateId) return false;
  const byId = new Map(groups.map((group) => [group.id, group]));
  if (!byId.has(groupId) || !byId.has(candidateId)) return false;

  const parentDepth = candidateDepth(groupId, candidateId, byId);
  const childDepth = descendantDepth(groupId, groups);
  if (parentDepth === null || childDepth === null) return false;
  return parentDepth + 1 + childDepth <= maxDepth;
}
