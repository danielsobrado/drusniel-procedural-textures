import {
  addSurfaceGraphNode,
  connectSurfaceGraphPorts,
  disconnectSurfaceGraphInput,
  exposeSurfaceGraphNodeParameter,
  removeSurfaceGraphExposedParameter,
  removeSurfaceGraphNode,
  setSurfaceGraphNodeParameter,
  setSurfaceGraphNodePosition,
  setSurfaceGraphOutput,
  surfaceGraphOutputTypesCompatible,
  surfaceGraphPortTypesCompatible
} from '../core/graph/SurfaceGraphMutation';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphNodeKind,
  SurfaceGraphParameterValue,
  SurfaceGraphValueType
} from '../core/graph/SurfaceGraph';
import {
  drawSurfaceGraphConnectionPreview,
  drawSurfaceGraphEdges,
  type GraphConnectionPreview
} from './surfaceGraph/GraphEdgeRenderer';
import { graphWorkspaceMarkup } from './surfaceGraph/GraphMarkup';
import {
  createSurfaceGraphNode,
  duplicateSurfaceGraphNode,
  GRAPH_NODE_WIDTH,
  GRAPH_VIRTUAL_OUTPUT_ID,
  graphExposedId,
  humanizeGraphParameter
} from './surfaceGraph/GraphNodeFactory';
import { GraphViewportController } from './surfaceGraph/GraphViewportController';

const OUTPUT_KIND: SurfaceGraphNodeKind = 'output';
const OUTPUT_CHANNELS = [
  'baseColor', 'roughness', 'metallic', 'normal', 'height', 'ao', 'emissive', 'opacity', 'clearcoat', 'sss'
] as const;

type OutputChannel = typeof OUTPUT_CHANNELS[number];

type DragState = {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

type ConnectionState = GraphConnectionPreview & { pointerId: number };

export interface SurfaceGraphEditorCallbacks {
  onGraphChange: (graph: SurfaceGraphDefinition, coalesceKey?: string) => void;
  onClose: () => void;
  onError: (error: unknown) => void;
}

function graphFingerprint(graph: Readonly<SurfaceGraphDefinition>): string {
  return JSON.stringify(graph);
}

function isOutputChannel(value: string): value is OutputChannel {
  return (OUTPUT_CHANNELS as readonly string[]).includes(value);
}

function socketSelector(direction: 'input' | 'output'): string {
  return `[data-port-direction="${direction}"][data-node-id][data-port]`;
}

export class SurfaceGraphEditor {
  private readonly viewport: GraphViewportController;
  private graph: SurfaceGraphDefinition | null = null;
  private fingerprint = '';
  private active = false;
  private selectedNodeId: string | null = null;
  private drag: DragState | null = null;
  private connection: ConnectionState | null = null;
  private browserOpen = false;
  private browserQuery = '';
  private lastFittedGraphId: string | null = null;
  private edgeFrame = 0;

  public constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: SurfaceGraphEditorCallbacks
  ) {
    this.viewport = new GraphViewportController(this.host, () => this.scheduleEdgeDraw());
    this.host.tabIndex = -1;
    this.host.addEventListener('click', (event) => this.handleClick(event));
    this.host.addEventListener('input', (event) => this.handleInput(event));
    this.host.addEventListener('change', (event) => this.handleChange(event));
    this.host.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.host.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    this.host.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.host.addEventListener('pointercancel', (event) => this.handlePointerCancel(event));
    this.host.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false });
    this.host.addEventListener('contextmenu', (event) => this.handleContextMenu(event));
    this.host.addEventListener('keydown', (event) => this.handleKeyDown(event));
    window.addEventListener('resize', () => this.scheduleEdgeDraw());
  }

  public render(graph: Readonly<SurfaceGraphDefinition> | null | undefined, active: boolean): void {
    this.active = active && graph !== null && graph !== undefined;
    this.host.hidden = !this.active;
    if (!this.active || graph === null || graph === undefined) {
      this.graph = null;
      this.fingerprint = '';
      this.drag = null;
      this.viewport.cancelPan();
      this.connection = null;
      return;
    }

    const nextFingerprint = graphFingerprint(graph);
    if (this.graph !== null && nextFingerprint === this.fingerprint) {
      this.scheduleEdgeDraw();
      return;
    }

    this.graph = structuredClone(graph);
    this.fingerprint = nextFingerprint;
    if (this.selectedNodeId !== null && !this.graph.nodes.some((node) => node.id === this.selectedNodeId)) {
      this.selectedNodeId = null;
    }
    this.build();
    if (this.lastFittedGraphId !== graph.id) {
      this.lastFittedGraphId = graph.id;
      window.requestAnimationFrame(() => {
        if (this.graph !== null) this.viewport.fit(this.graph);
      });
    }
  }

  private build(): void {
    if (this.graph === null) return;
    this.host.innerHTML = graphWorkspaceMarkup(
      this.graph,
      this.selectedNodeId,
      this.browserOpen,
      this.browserQuery
    );
    this.viewport.apply();
    this.filterBrowser();
    this.scheduleEdgeDraw();
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target === null) return;
    const graphAction = target.closest<HTMLElement>('[data-graph-action]')?.dataset.graphAction;
    if (graphAction === 'fit' && this.graph !== null) this.viewport.fit(this.graph);
    else if (graphAction === 'add') this.setBrowserOpen(true);
    else if (graphAction === 'close') this.callbacks.onClose();
    else if (graphAction === 'browser-close') this.setBrowserOpen(false);

    const actionElement = target.closest<HTMLElement>('[data-node-action]');
    const nodeAction = actionElement?.dataset.nodeAction;
    const nodeId = actionElement?.dataset.nodeId;
    if (actionElement !== null && nodeAction !== undefined && nodeId !== undefined) {
      if (nodeAction === 'select') this.selectNode(nodeId);
      else if (nodeAction === 'duplicate') this.duplicateNode(nodeId);
      else if (nodeAction === 'remove') this.removeNode(nodeId);
      else if (nodeAction === 'expose') this.exposeParameter(nodeId, actionElement.dataset.param ?? '');
      else if (nodeAction === 'unexpose') this.unexposeParameter(nodeId, actionElement.dataset.param ?? '');
      return;
    }

    const browserItem = target.closest<HTMLElement>('[data-node-kind]');
    if (browserItem !== null) {
      this.addNode(browserItem.dataset.nodeKind as SurfaceGraphNodeKind);
      return;
    }

    const graphNode = target.closest<HTMLElement>('[data-graph-node]')?.dataset.graphNode;
    if (graphNode !== undefined && graphNode !== GRAPH_VIRTUAL_OUTPUT_ID) this.selectNode(graphNode);
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role === 'graph-browser-search') {
      this.browserQuery = target.value;
      this.filterBrowser();
      return;
    }
    if (!target.hasAttribute('data-graph-param-range')) return;
    const nodeId = target.dataset.nodeId;
    const parameter = target.dataset.param;
    if (nodeId === undefined || parameter === undefined) return;
    const numberInput = Array.from(this.host.querySelectorAll<HTMLInputElement>('.sg-param-number[data-graph-param]'))
      .find((input) => input.dataset.nodeId === nodeId && input.dataset.param === parameter);
    if (numberInput !== undefined) numberInput.value = target.value;
  }

  private handleChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-graph-param') || this.graph === null) return;
    const nodeId = target.dataset.nodeId;
    const parameter = target.dataset.param;
    const kind = target.dataset.paramValue;
    if (nodeId === undefined || parameter === undefined || kind === undefined) return;

    let value: SurfaceGraphParameterValue;
    if (kind === 'number') {
      const number = Number(target.value);
      if (!Number.isFinite(number)) return;
      value = number;
    } else if (kind === 'boolean') {
      value = target.checked;
    } else {
      value = target.value;
    }

    this.mutate(() => setSurfaceGraphNodeParameter(this.graph!, nodeId, parameter, value),
      `surface-graph:param:${nodeId}:${parameter}`);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.active || this.graph === null) return;
    event.stopPropagation();
    const target = event.target as Element | null;
    if (target === null) return;

    const outputSocket = target.closest<HTMLElement>(socketSelector('output'));
    if (outputSocket !== null && event.button === 0) {
      const nodeId = outputSocket.dataset.nodeId;
      const port = outputSocket.dataset.port;
      const type = outputSocket.dataset.portType as SurfaceGraphValueType | undefined;
      if (nodeId !== undefined && port !== undefined && type !== undefined) {
        event.preventDefault();
        this.connection = {
          pointerId: event.pointerId,
          from: { nodeId, port },
          type,
          clientX: event.clientX,
          clientY: event.clientY
        };
        this.capturePointer(event.pointerId);
        this.drawConnectionPreview();
      }
      return;
    }

    const dragHandle = target.closest<HTMLElement>('[data-node-drag]');
    const nodeId = dragHandle?.dataset.nodeDrag;
    if (nodeId !== undefined && event.button === 0) {
      const node = this.graph.nodes.find((item) => item.id === nodeId);
      if (node === undefined || node.kind === OUTPUT_KIND) return;
      event.preventDefault();
      this.selectNode(nodeId, false);
      this.drag = {
        pointerId: event.pointerId,
        nodeId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: node.position.x,
        startY: node.position.y
      };
      this.capturePointer(event.pointerId);
      this.nodeElement(nodeId)?.classList.add('is-dragging');
      return;
    }

    const stage = target.closest<HTMLElement>('[data-role="graph-stage"]');
    const blocked = target.closest('.sg-side-panel, .sg-toolbar, .sg-node-browser, .sg-node');
    if (stage !== null && blocked === null && event.button === 0) {
      event.preventDefault();
      this.host.focus({ preventScroll: true });
      this.viewport.beginPan(event);
      this.capturePointer(event.pointerId);
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.graph === null) return;
    if (this.drag !== null && event.pointerId === this.drag.pointerId) {
      const node = this.graph.nodes.find((item) => item.id === this.drag?.nodeId);
      if (node === undefined) return;
      node.position.x = this.drag.startX + (event.clientX - this.drag.startClientX) / this.viewport.zoom;
      node.position.y = this.drag.startY + (event.clientY - this.drag.startClientY) / this.viewport.zoom;
      const element = this.nodeElement(node.id);
      if (element !== null) {
        element.style.left = `${node.position.x}px`;
        element.style.top = `${node.position.y}px`;
      }
      this.scheduleEdgeDraw();
      return;
    }
    if (this.viewport.updatePan(event)) return;
    if (this.connection !== null && event.pointerId === this.connection.pointerId) {
      this.connection.clientX = event.clientX;
      this.connection.clientY = event.clientY;
      this.drawConnectionPreview();
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.graph === null) return;
    if (this.drag !== null && event.pointerId === this.drag.pointerId) {
      const drag = this.drag;
      this.drag = null;
      this.releasePointer(event.pointerId);
      this.nodeElement(drag.nodeId)?.classList.remove('is-dragging');
      const node = this.graph.nodes.find((item) => item.id === drag.nodeId);
      if (node !== undefined) {
        this.mutate(
          () => setSurfaceGraphNodePosition(this.graph!, drag.nodeId, node.position),
          `surface-graph:position:${drag.nodeId}`
        );
      }
      return;
    }
    if (this.viewport.endPan(event.pointerId)) {
      this.releasePointer(event.pointerId);
      return;
    }
    if (this.connection !== null && event.pointerId === this.connection.pointerId) {
      const connection = this.connection;
      this.connection = null;
      this.releasePointer(event.pointerId);
      const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(socketSelector('input')) ?? null;
      if (hit !== null) this.finishConnection(connection, hit);
      this.drawConnectionPreview();
    }
  }

  private handlePointerCancel(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId && this.graph !== null) {
      const node = this.graph.nodes.find((item) => item.id === this.drag?.nodeId);
      if (node !== undefined && this.drag !== null) {
        node.position = { x: this.drag.startX, y: this.drag.startY };
      }
      this.drag = null;
      this.build();
    }
    this.viewport.cancelPan(event.pointerId);
    if (this.connection?.pointerId === event.pointerId) this.connection = null;
    this.releasePointer(event.pointerId);
    this.drawConnectionPreview();
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.active || this.graph === null) return;
    const target = event.target as Element | null;
    const stage = target?.closest<HTMLElement>('[data-role="graph-stage"]') ?? null;
    if (stage === null || target?.closest('.sg-side-panel, .sg-node-browser') !== null) return;
    event.preventDefault();
    event.stopPropagation();
    this.viewport.zoomAt(event, stage);
  }

  private handleContextMenu(event: MouseEvent): void {
    if (!this.active || this.graph === null) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as Element | null;
    const inputSocket = target?.closest<HTMLElement>(socketSelector('input')) ?? null;
    if (inputSocket !== null) {
      this.disconnectInput(inputSocket);
      return;
    }
    if (target?.closest('.sg-node, .sg-side-panel, .sg-toolbar') === null) this.setBrowserOpen(true);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.active || this.graph === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.connection !== null) {
        this.connection = null;
        this.drawConnectionPreview();
      } else if (this.browserOpen) {
        this.setBrowserOpen(false);
      }
      return;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      this.viewport.fit(this.graph);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedNodeId !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.removeNode(this.selectedNodeId);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'd' && this.selectedNodeId !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.duplicateNode(this.selectedNodeId);
    }
  }

  private finishConnection(connection: ConnectionState, target: HTMLElement): void {
    if (this.graph === null) return;
    const nodeId = target.dataset.nodeId;
    const port = target.dataset.port;
    const targetType = target.dataset.portType as SurfaceGraphValueType | undefined;
    if (nodeId === undefined || port === undefined || targetType === undefined) return;

    const outputTarget = nodeId === GRAPH_VIRTUAL_OUTPUT_ID ||
      this.graph.nodes.some((node) => node.id === nodeId && node.kind === OUTPUT_KIND);
    const compatible = outputTarget
      ? surfaceGraphOutputTypesCompatible(connection.type, targetType)
      : surfaceGraphPortTypesCompatible(connection.type, targetType);
    if (!compatible) {
      this.callbacks.onError(new Error(`Cannot connect ${connection.type} to ${targetType}.`));
      return;
    }

    this.mutate(() => nodeId === GRAPH_VIRTUAL_OUTPUT_ID && isOutputChannel(port)
      ? setSurfaceGraphOutput(this.graph!, port, connection.from)
      : connectSurfaceGraphPorts(this.graph!, connection.from, { nodeId, port }),
    `surface-graph:connect:${nodeId}:${port}`);
  }

  private disconnectInput(target: HTMLElement): void {
    if (this.graph === null) return;
    const nodeId = target.dataset.nodeId;
    const port = target.dataset.port;
    if (nodeId === undefined || port === undefined) return;
    if (nodeId === GRAPH_VIRTUAL_OUTPUT_ID && isOutputChannel(port)) {
      this.mutate(() => {
        const next = structuredClone(this.graph!);
        next.outputs = next.outputs.filter((output) => output.channel !== port);
        return next;
      }, `surface-graph:output:${port}`);
      return;
    }
    this.mutate(() => disconnectSurfaceGraphInput(this.graph!, { nodeId, port }),
      `surface-graph:disconnect:${nodeId}:${port}`);
  }

  private addNode(kind: SurfaceGraphNodeKind): void {
    if (this.graph === null) return;
    const stage = this.host.querySelector<HTMLElement>('[data-role="graph-stage"]');
    if (stage === null) return;
    const bounds = stage.getBoundingClientRect();
    const sidePanelWidth = this.host.querySelector<HTMLElement>('.sg-side-panel')?.offsetWidth ?? 0;
    const center = this.viewport.toWorld(
      bounds.left + bounds.width * 0.5 - sidePanelWidth * 0.25,
      bounds.top + bounds.height * 0.48
    );
    if (center === null) return;

    try {
      const node = createSurfaceGraphNode(this.graph, kind, {
        x: center.x - GRAPH_NODE_WIDTH * 0.5,
        y: center.y - 80
      });
      this.selectedNodeId = node.id;
      this.browserOpen = false;
      this.browserQuery = '';
      this.commitGraph(addSurfaceGraphNode(this.graph, node), 'surface-graph:add-node');
    } catch (error) {
      this.callbacks.onError(error);
    }
  }

  private duplicateNode(nodeId: string): void {
    if (this.graph === null) return;
    const source = this.graph.nodes.find((node) => node.id === nodeId);
    if (source === undefined || source.kind === OUTPUT_KIND) return;
    try {
      const duplicate = duplicateSurfaceGraphNode(source, { x: source.position.x + 48, y: source.position.y + 48 });
      this.selectedNodeId = duplicate.id;
      this.commitGraph(addSurfaceGraphNode(this.graph, duplicate), 'surface-graph:duplicate-node');
    } catch (error) {
      this.callbacks.onError(error);
    }
  }

  private removeNode(nodeId: string): void {
    if (this.graph === null) return;
    this.mutate(() => removeSurfaceGraphNode(this.graph!, nodeId), 'surface-graph:remove-node', () => {
      this.selectedNodeId = null;
    });
  }

  private exposeParameter(nodeId: string, parameter: string): void {
    if (this.graph === null || parameter.length === 0) return;
    this.mutate(
      () => exposeSurfaceGraphNodeParameter(
        this.graph!, nodeId, parameter, graphExposedId(nodeId, parameter), humanizeGraphParameter(parameter)
      ),
      `surface-graph:expose:${nodeId}:${parameter}`
    );
  }

  private unexposeParameter(nodeId: string, parameter: string): void {
    if (this.graph === null || parameter.length === 0) return;
    this.mutate(() => removeSurfaceGraphExposedParameter(this.graph!, nodeId, parameter),
      `surface-graph:unexpose:${nodeId}:${parameter}`);
  }

  private mutate(
    mutation: () => SurfaceGraphDefinition,
    coalesceKey?: string,
    beforeCommit?: () => void
  ): void {
    try {
      const next = mutation();
      beforeCommit?.();
      this.commitGraph(next, coalesceKey);
    } catch (error) {
      this.callbacks.onError(error);
    }
  }

  private selectNode(nodeId: string | null, rebuild = true): void {
    if (this.selectedNodeId === nodeId) return;
    this.selectedNodeId = nodeId;
    if (rebuild) this.build();
  }

  private setBrowserOpen(open: boolean): void {
    this.browserOpen = open;
    const browser = this.host.querySelector<HTMLElement>('[data-role="graph-browser"]');
    if (browser === null) {
      this.build();
      return;
    }
    browser.classList.toggle('is-open', open);
    browser.setAttribute('aria-hidden', String(!open));
    if (open) {
      window.requestAnimationFrame(() => this.host.querySelector<HTMLInputElement>('[data-role="graph-browser-search"]')?.focus());
    } else {
      this.host.focus({ preventScroll: true });
    }
  }

  private filterBrowser(): void {
    const query = this.browserQuery.trim().toLowerCase();
    for (const item of this.host.querySelectorAll<HTMLElement>('[data-node-kind]')) {
      item.hidden = query.length > 0 && !(item.dataset.search ?? '').includes(query);
    }
  }

  private commitGraph(next: SurfaceGraphDefinition, coalesceKey?: string): void {
    this.callbacks.onGraphChange(next, coalesceKey);
    this.graph = structuredClone(next);
    this.fingerprint = graphFingerprint(next);
    this.build();
  }

  private scheduleEdgeDraw(): void {
    if (!this.active || this.edgeFrame !== 0) return;
    this.edgeFrame = window.requestAnimationFrame(() => {
      this.edgeFrame = 0;
      if (this.graph !== null) drawSurfaceGraphEdges(this.host, this.graph);
      this.drawConnectionPreview();
    });
  }

  private drawConnectionPreview(): void {
    drawSurfaceGraphConnectionPreview(this.host, this.connection);
  }

  private nodeElement(nodeId: string): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(`[data-graph-node="${CSS.escape(nodeId)}"]`);
  }

  private capturePointer(pointerId: number): void {
    try { this.host.setPointerCapture(pointerId); } catch { /* Best effort. */ }
  }

  private releasePointer(pointerId: number): void {
    try {
      if (this.host.hasPointerCapture(pointerId)) this.host.releasePointerCapture(pointerId);
    } catch { /* Best effort. */ }
  }
}
