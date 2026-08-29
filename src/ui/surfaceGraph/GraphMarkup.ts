import type {
  SurfaceGraphDefinition,
  SurfaceGraphNode,
  SurfaceGraphParameterValue,
  SurfaceGraphValueType
} from '../../core/graph/SurfaceGraph';
import type { SurfaceGraphNodeStatus } from '../../core/graph/SurfaceGraphCatalog';
import { TEXTURE_FIELD_MODES } from '../../core/texture/TextureFieldSettings';
import { escapeHtml } from '../../utils/html';
import {
  GRAPH_VIRTUAL_OUTPUT_ID,
  graphNodeBrowserSpecs,
  graphOutputPosition,
  humanizeGraphParameter,
  surfaceGraphNodeSpec
} from './GraphNodeFactory';

const OUTPUT_KIND = 'output';
const MASK_INPUT_PORTS = new Set(['mask', 'opacity', 'density', 'intensity']);

function parameterRange(parameter: string): { min: number; max: number; step: number } | null {
  if (['opacity', 'jitter', 'roundness', 'offset', 'edgeWear', 'amount', 'damage'].includes(parameter)) {
    return { min: 0, max: 1, step: 0.01 };
  }
  if (parameter === 'density') return { min: 0, max: 4, step: 0.01 };
  if (parameter === 'gap') return { min: 0, max: 0.45, step: 0.005 };
  if (parameter === 'scale') return { min: 0.1, max: 20, step: 0.05 };
  if (parameter === 'strength') return { min: 0, max: 2.5, step: 0.01 };
  if (parameter === 'modeAmount') return { min: 0, max: 4, step: 0.01 };
  if (parameter === 'seed') return { min: 0, max: 100, step: 1 };
  if (parameter === 'rotation') return { min: -1, max: 1, step: 0.01 };
  if (parameter === 'roughness') return { min: -0.5, max: 0.5, step: 0.01 };
  if (parameter === 'displacement' || parameter === 'height') return { min: -0.18, max: 0.18, step: 0.002 };
  if (['contrast', 'saturation', 'lightness', 'hue', 'bias'].includes(parameter)) return { min: -2, max: 2, step: 0.01 };
  return null;
}

function canExposeParameter(parameter: string, value: SurfaceGraphParameterValue): boolean {
  return typeof value === 'number' || typeof value === 'boolean' ||
    (typeof value === 'string' && (/^#[0-9a-f]{6}$/iu.test(value) || parameter === 'mode'));
}

function runtimeOverrides(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string
): { structure: boolean; mask: boolean } {
  const incoming = graph.edges.filter((edge) => edge.to.nodeId === nodeId);
  const maskCount = incoming.filter((edge) => MASK_INPUT_PORTS.has(edge.to.port)).length;
  const structureCount = incoming.length - maskCount;
  return {
    structure: structureCount > 0 || maskCount > 1,
    mask: maskCount > 0 || structureCount > 1
  };
}

function legacyDependencies(
  graph: Readonly<SurfaceGraphDefinition>,
  node: Readonly<SurfaceGraphNode>
): { structure: string | null; mask: string | null } {
  const overrides = runtimeOverrides(graph, node.id);
  return {
    structure: overrides.structure ? null : node.runtime?.structureFrom ?? null,
    mask: overrides.mask ? null : node.runtime?.maskFrom ?? null
  };
}

function visibleRouteCount(graph: Readonly<SurfaceGraphDefinition>): number {
  const outputNodeId = graph.nodes.find((node) => node.kind === OUTPUT_KIND)?.id ?? GRAPH_VIRTUAL_OUTPUT_ID;
  const routes = new Set(graph.edges.map((edge) =>
    `${edge.from.nodeId}:${edge.from.port}>${edge.to.nodeId}:${edge.to.port}`
  ));
  for (const output of graph.outputs) {
    routes.add(`${output.source.nodeId}:${output.source.port}>${outputNodeId}:${output.channel}`);
  }
  for (const node of graph.nodes) {
    const dependencies = legacyDependencies(graph, node);
    if (dependencies.structure !== null) routes.add(`structure:${dependencies.structure}>${node.id}`);
    if (dependencies.mask !== null) routes.add(`mask:${dependencies.mask}>${node.id}`);
  }
  return routes.size;
}

function portMarkup(
  nodeId: string,
  port: string,
  type: SurfaceGraphValueType,
  direction: 'input' | 'output',
  optional: boolean
): string {
  const socket = `<button class="sg-socket" data-port-direction="${direction}" data-node-id="${escapeHtml(nodeId)}" data-port="${escapeHtml(port)}" data-port-type="${type}" aria-label="${escapeHtml(port)} ${direction}"></button>`;
  return `
    <div class="sg-port sg-port-${direction}" data-port-row>
      ${direction === 'input' ? socket : ''}
      <span>${escapeHtml(port)}${optional ? '<sup>○</sup>' : ''}</span>
      <em>${escapeHtml(type)}</em>
      ${direction === 'output' ? socket : ''}
    </div>
  `;
}

function nodeMarkup(
  graph: Readonly<SurfaceGraphDefinition>,
  node: Readonly<SurfaceGraphNode>,
  selectedNodeId: string | null
): string {
  const spec = surfaceGraphNodeSpec(node.kind);
  const dependencies = legacyDependencies(graph, node);
  const dependencyCount = Number(dependencies.mask !== null) + Number(dependencies.structure !== null);
  return `
    <article class="sg-node ${node.id === selectedNodeId ? 'is-selected' : ''}" data-graph-node="${escapeHtml(node.id)}" data-category="${spec.category}" style="left:${node.position.x}px;top:${node.position.y}px" aria-label="${escapeHtml(node.label)} node">
      <div class="sg-node-accent"></div>
      <header class="sg-node-header" data-node-drag="${escapeHtml(node.id)}">
        <span class="sg-node-glyph">${escapeHtml(spec.label.slice(0, 2).toUpperCase())}</span>
        <div class="sg-node-title"><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(spec.label)}</small></div>
        <button class="sg-node-menu" data-node-action="select" data-node-id="${escapeHtml(node.id)}" aria-label="Inspect ${escapeHtml(node.label)}">•••</button>
      </header>
      <div class="sg-node-ports">
        <div class="sg-port-column sg-port-inputs">
          ${spec.inputs.map((port) => portMarkup(node.id, port.name, port.type, 'input', port.optional === true)).join('')}
        </div>
        <div class="sg-port-column sg-port-outputs">
          ${spec.outputs.map((port) => portMarkup(node.id, port.name, port.type, 'output', port.optional === true)).join('')}
        </div>
      </div>
      <footer class="sg-node-footer">
        <span>${escapeHtml(spec.category)}</span>
        <span>${dependencyCount > 0 ? `${dependencyCount} field link${dependencyCount === 1 ? '' : 's'} · ` : ''}${Object.keys(node.params).length} params</span>
      </footer>
    </article>
  `;
}

function virtualOutputMarkup(graph: Readonly<SurfaceGraphDefinition>): string {
  const spec = surfaceGraphNodeSpec(OUTPUT_KIND);
  const position = graphOutputPosition(graph);
  return `
    <article class="sg-node sg-output-node" data-graph-node="${GRAPH_VIRTUAL_OUTPUT_ID}" data-category="output" style="left:${position.x}px;top:${position.y}px" aria-label="Material Output node">
      <div class="sg-node-accent"></div>
      <header class="sg-node-header">
        <span class="sg-node-glyph">PBR</span>
        <div class="sg-node-title"><strong>Material Output</strong><small>Portable PBR surface</small></div>
        <span class="sg-lock-mark" aria-hidden="true">◆</span>
      </header>
      <div class="sg-node-ports sg-output-ports">
        <div class="sg-port-column sg-port-inputs">
          ${spec.inputs.map((port) => portMarkup(GRAPH_VIRTUAL_OUTPUT_ID, port.name, port.type, 'input', true)).join('')}
        </div>
      </div>
      <footer class="sg-node-footer"><span>output</span><span>${graph.outputs.length} linked</span></footer>
    </article>
  `;
}

function parameterMarkup(
  graph: Readonly<SurfaceGraphDefinition>,
  node: Readonly<SurfaceGraphNode>,
  parameter: string,
  value: SurfaceGraphParameterValue
): string {
  const exposed = graph.exposed.some((item) => item.nodeId === node.id && item.parameter === parameter);
  const exposeButton = canExposeParameter(parameter, value)
    ? `<button class="sg-expose-button ${exposed ? 'is-exposed' : ''}" data-node-action="${exposed ? 'unexpose' : 'expose'}" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}">${exposed ? 'Exposed' : 'Expose'}</button>`
    : '';
  const label = humanizeGraphParameter(parameter);

  if (typeof value === 'number') {
    const range = parameterRange(parameter);
    const rangeMarkup = range === null ? '' : `
      <input data-graph-param data-graph-param-range data-param-value="number" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${value}">`;
    return `
      <label class="sg-param-control">
        <span class="sg-param-label"><strong>${escapeHtml(label)}</strong>${exposeButton}</span>
        ${rangeMarkup}
        <input class="sg-param-number" data-graph-param data-param-value="number" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}" type="number" ${range === null ? 'step="any"' : `min="${range.min}" max="${range.max}" step="${range.step}"`} value="${value}">
      </label>
    `;
  }
  if (typeof value === 'boolean') {
    return `<label class="sg-param-control sg-param-toggle"><span class="sg-param-label"><strong>${escapeHtml(label)}</strong>${exposeButton}</span><input data-graph-param data-param-value="boolean" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}" type="checkbox" ${value ? 'checked' : ''}></label>`;
  }
  if (typeof value === 'string') {
    const color = /^#[0-9a-f]{6}$/iu.test(value);
    if (parameter === 'mode') {
      return `
        <label class="sg-param-control">
          <span class="sg-param-label"><strong>${escapeHtml(label)}</strong>${exposeButton}</span>
          <select class="sg-param-text" data-graph-param data-param-value="string" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}">
            ${TEXTURE_FIELD_MODES.map((mode) => `<option value="${mode}" ${mode === value ? 'selected' : ''}>${escapeHtml(humanizeGraphParameter(mode))}</option>`).join('')}
          </select>
        </label>
      `;
    }
    return `
      <label class="sg-param-control">
        <span class="sg-param-label"><strong>${escapeHtml(label)}</strong>${exposeButton}</span>
        <div class="sg-param-text-row">
          ${color ? `<input class="sg-param-color" data-graph-param data-param-value="string" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}" type="color" value="${escapeHtml(value)}">` : ''}
          <input class="sg-param-text" data-graph-param data-param-value="string" data-node-id="${escapeHtml(node.id)}" data-param="${escapeHtml(parameter)}" type="text" value="${escapeHtml(value)}">
        </div>
      </label>
    `;
  }
  return `<div class="sg-param-control sg-param-readonly"><span class="sg-param-label"><strong>${escapeHtml(label)}</strong></span><code>${escapeHtml(JSON.stringify(value))}</code></div>`;
}

function inspectorMarkup(graph: Readonly<SurfaceGraphDefinition>, selectedNodeId: string | null): string {
  const node = graph.nodes.find((item) => item.id === selectedNodeId) ?? null;
  if (node === null) {
    return `<aside class="sg-side-panel" aria-label="Surface Graph node inspector"><div class="sg-side-empty"><span aria-hidden="true">◇</span><strong>Select a node</strong><p>Inspect parameters, expose controls, duplicate nodes, and tune the authored graph.</p></div></aside>`;
  }
  const spec = surfaceGraphNodeSpec(node.kind);
  const params = Object.entries(node.params);
  const legacy = legacyDependencies(graph, node);
  const dependencies = [
    legacy.structure === null ? null : `structure ← ${legacy.structure}`,
    legacy.mask === null ? null : `mask ← ${legacy.mask}`
  ].filter((item): item is string => item !== null);
  return `
    <aside class="sg-side-panel" aria-label="Surface Graph node inspector">
      <div class="sg-side-heading">
        <div><span class="sg-kicker">Node inspector</span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(spec.category)} / ${escapeHtml(node.kind)}</small></div>
        <div class="sg-side-actions">
          <button class="sg-icon-button" data-node-action="duplicate" data-node-id="${escapeHtml(node.id)}" title="Duplicate" aria-label="Duplicate ${escapeHtml(node.label)}">⧉</button>
          ${node.kind === OUTPUT_KIND ? '' : `<button class="sg-icon-button sg-danger" data-node-action="remove" data-node-id="${escapeHtml(node.id)}" title="Delete" aria-label="Delete ${escapeHtml(node.label)}">×</button>`}
        </div>
      </div>
      <div class="sg-node-meta">
        <span>${spec.inputs.length} inputs</span><span>${spec.outputs.length} outputs</span>${node.runtime === undefined ? '<span>auto lower</span>' : '<span>runtime bound</span>'}
        ${dependencies.map((dependency) => `<span class="sg-dependency-chip">${escapeHtml(dependency)}</span>`).join('')}
      </div>
      <div class="sg-param-list">
        ${params.length === 0 ? '<div class="sg-param-empty">This operation has no authored parameters.</div>' : params.map(([parameter, value]) => parameterMarkup(graph, node, parameter, value)).join('')}
      </div>
      <div class="sg-side-note">Formal wires override legacy runtime field links and compile through the same PTL Runtime Material Definition path used by export.</div>
    </aside>
  `;
}

function nodeStatusLabel(status: SurfaceGraphNodeStatus): string {
  return status === 'preview' ? 'approximate' : 'not implemented';
}

function nodeStatusHint(status: SurfaceGraphNodeStatus): string {
  return status === 'preview'
    ? 'Approximated by a related procedural layer. The result is usable but is not the exact operation.'
    : 'Declared but not implemented yet. This node contributes nothing to the material.';
}

function browserMarkup(graph: Readonly<SurfaceGraphDefinition>, open: boolean, query: string): string {
  const specs = graphNodeBrowserSpecs(graph);
  return `
    <div class="sg-node-browser ${open ? 'is-open' : ''}" data-role="graph-browser" role="dialog" aria-modal="true" aria-label="Add Surface Graph node" aria-hidden="${open ? 'false' : 'true'}">
      <div class="sg-browser-panel">
        <div class="sg-browser-heading">
          <div><span>Add node</span><small>${specs.length} available operations</small></div>
          <button class="sg-icon-button" data-graph-action="browser-close" aria-label="Close node browser">×</button>
        </div>
        <label class="sg-browser-search">
          <span aria-hidden="true">⌕</span>
          <input data-role="graph-browser-search" type="search" autocomplete="off" placeholder="Search nodes…" value="${escapeHtml(query)}" aria-label="Search Surface Graph nodes">
        </label>
        <div class="sg-browser-list" data-role="graph-browser-list">
          ${specs.map((spec) => `
            <button class="sg-browser-item" data-node-kind="${spec.kind}" data-node-status="${spec.status}" data-search="${escapeHtml(`${spec.label} ${spec.kind} ${spec.category}`.toLowerCase())}"${spec.status === 'stable' ? '' : ` title="${escapeHtml(nodeStatusHint(spec.status))}"`}>
              <span class="sg-browser-icon" data-category="${spec.category}">${escapeHtml(spec.label.slice(0, 2).toUpperCase())}</span>
              <span><strong>${escapeHtml(spec.label)}${spec.status === 'stable' ? '' : ` <em class="sg-browser-badge">${escapeHtml(nodeStatusLabel(spec.status))}</em>`}</strong><small>${escapeHtml(spec.category)} · ${spec.outputs.length} output${spec.outputs.length === 1 ? '' : 's'}</small></span>
              <i aria-hidden="true">＋</i>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

export function graphWorkspaceMarkup(
  graph: Readonly<SurfaceGraphDefinition>,
  selectedNodeId: string | null,
  browserOpen: boolean,
  browserQuery: string
): string {
  const hasOutputNode = graph.nodes.some((node) => node.kind === OUTPUT_KIND);
  return `
    <div class="sg-workspace-shell">
      <header class="sg-toolbar">
        <div class="sg-title-group">
          <span class="sg-kicker">Surface Designer</span>
          <div class="sg-title-row"><strong>${escapeHtml(graph.name)}</strong><span class="sg-live-chip"><i></i> Live compile</span></div>
        </div>
        <div class="sg-toolbar-stats" aria-label="Surface Graph statistics">
          <span><strong>${graph.nodes.length}</strong> nodes</span>
          <span><strong>${visibleRouteCount(graph)}</strong> routes</span>
          <span><strong>${graph.exposed.length}</strong> exposed</span>
        </div>
        <div class="sg-toolbar-actions">
          <span class="sg-zoom-label" data-role="graph-zoom">100%</span>
          <button class="sg-tool-button" data-graph-action="fit" title="Fit graph (F)">Fit</button>
          <button class="sg-tool-button sg-tool-primary" data-graph-action="add">＋ Node</button>
          <button class="sg-tool-button" data-graph-action="close" title="Return to 3D preview">3D Preview</button>
        </div>
      </header>
      <div class="sg-stage" data-role="graph-stage" role="region" aria-label="Surface Graph workspace">
        <div class="sg-grid" aria-hidden="true"></div>
        <svg class="sg-edge-layer" data-role="graph-edges" aria-hidden="true">
          <defs>
            <filter id="sg-edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" result="blur"></feGaussianBlur>
              <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
            </filter>
          </defs>
          <g data-role="graph-edge-paths"></g>
          <g data-role="graph-edge-preview"></g>
        </svg>
        <div class="sg-world" data-role="graph-world">
          ${graph.nodes.map((node) => nodeMarkup(graph, node, selectedNodeId)).join('')}
          ${hasOutputNode ? '' : virtualOutputMarkup(graph)}
        </div>
        ${inspectorMarkup(graph, selectedNodeId)}
        ${browserMarkup(graph, browserOpen, browserQuery)}
        <div class="sg-hint">Drag nodes · drag output to input · wheel to zoom · right-click input to disconnect · dashed = legacy runtime field link</div>
      </div>
    </div>
  `;
}
