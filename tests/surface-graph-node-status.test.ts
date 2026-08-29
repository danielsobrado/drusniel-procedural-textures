import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SURFACE_GRAPH_NODE_SPECS,
  type SurfaceGraphNodeStatus
} from '../src/core/graph/SurfaceGraphCatalog';
import type { SurfaceGraphNodeKind } from '../src/core/graph/SurfaceGraph';
import { graphNodeBrowserSpecs } from '../src/ui/surfaceGraph/GraphNodeFactory';

const loweringSource = readFileSync(
  new URL('../src/core/graph/SurfaceGraphRuntimeLowering.ts', import.meta.url),
  'utf8'
);

/** The HEIGHT_KINDS set is the lowering's own list of kinds it has no real handling for. */
function loweringGenericKinds(): Set<string> {
  const block = /const HEIGHT_KINDS = new Set<SurfaceGraphNodeKind>\(\[([\s\S]*?)\]\)/u
    .exec(loweringSource);
  if (block === null) throw new Error('Could not read HEIGHT_KINDS from the lowering.');
  return new Set([...block[1]!.matchAll(/'([a-z0-9-]+)'/gu)].map((match) => match[1]!));
}

function kindsWithStatus(status: SurfaceGraphNodeStatus): Set<SurfaceGraphNodeKind> {
  return new Set(
    SURFACE_GRAPH_NODE_SPECS.filter((spec) => spec.status === status).map((spec) => spec.kind)
  );
}

describe('surface graph node status', () => {
  it('marks exactly the lowering-generic kinds as planned', () => {
    // Drift here means the catalog is advertising a node the lowering silently drops, or hiding
    // one that now works. Both are worse than the mismatch itself.
    expect([...kindsWithStatus('planned')].sort()).toEqual([...loweringGenericKinds()].sort());
  });

  it('classifies every kind exactly once', () => {
    const total = SURFACE_GRAPH_NODE_SPECS.length;
    const stable = kindsWithStatus('stable').size;
    const preview = kindsWithStatus('preview').size;
    const planned = kindsWithStatus('planned').size;

    expect(stable + preview + planned).toBe(total);
    expect(total).toBe(64);
  });

  it('keeps the kinds shipped presets depend on out of the planned set once implemented', () => {
    // height-blend was the first operator to land. It must never regress to planned.
    const planned = kindsWithStatus('planned');
    expect(planned.has('height-blend')).toBe(false);
    expect(kindsWithStatus('stable').has('height-blend')).toBe(true);
  });

  it('never marks structural kinds as anything but stable', () => {
    const stable = kindsWithStatus('stable');
    expect(stable.has('output')).toBe(true);
    expect(stable.has('subgraph')).toBe(true);
  });
});

describe('node browser listing', () => {
  const graph = { version: 1, id: 'g', name: 'G', nodes: [], edges: [], outputs: [], exposed: [], groups: [], subgraphs: [] } as never;

  it('withholds kinds that contribute nothing to the material', () => {
    const listed = graphNodeBrowserSpecs(graph);

    expect(listed.some((spec) => spec.status === 'planned')).toBe(false);
    expect(listed).toHaveLength(
      SURFACE_GRAPH_NODE_SPECS.filter(
        (spec) => spec.status !== 'planned' && spec.kind !== 'output' && spec.kind !== 'subgraph'
      ).length
    );
  });

  it('still offers approximated kinds, so they are badged rather than hidden', () => {
    const listed = graphNodeBrowserSpecs(graph);

    expect(listed.some((spec) => spec.status === 'preview')).toBe(true);
    expect(listed.some((spec) => spec.kind === 'flood-fill')).toBe(true);
  });

  it('can surface the unimplemented kinds on request', () => {
    const withPlanned = graphNodeBrowserSpecs(graph, true);

    expect(withPlanned.some((spec) => spec.kind === 'blur')).toBe(true);
    expect(withPlanned.length).toBeGreaterThan(graphNodeBrowserSpecs(graph).length);
  });

  it('keeps structural kinds out of the browser either way', () => {
    for (const listed of [graphNodeBrowserSpecs(graph), graphNodeBrowserSpecs(graph, true)]) {
      expect(listed.some((spec) => spec.kind === 'output')).toBe(false);
      expect(listed.some((spec) => spec.kind === 'subgraph')).toBe(false);
    }
  });
});
