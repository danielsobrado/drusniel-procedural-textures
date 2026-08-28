import type { SurfaceGraphDefinition } from '../../core/graph/SurfaceGraph';
import { GRAPH_VIRTUAL_OUTPUT_ID, graphOutputPosition } from './GraphNodeFactory';

const MIN_ZOOM = 0.34;
const MAX_ZOOM = 1.85;
const MAX_FIT_ZOOM = 1.18;
const FIT_PADDING = 84;
const GRID_SIZE = 28;

type PanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

export class GraphViewportController {
  private zoomValue = 1;
  private panX = 0;
  private panY = 0;
  private pan: PanState | null = null;

  public constructor(
    private readonly host: HTMLElement,
    private readonly onTransform: () => void
  ) {}

  public get zoom(): number {
    return this.zoomValue;
  }

  public beginPan(event: PointerEvent): void {
    this.pan = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: this.panX,
      startY: this.panY
    };
  }

  public updatePan(event: PointerEvent): boolean {
    if (this.pan === null || this.pan.pointerId !== event.pointerId) return false;
    this.panX = this.pan.startX + event.clientX - this.pan.startClientX;
    this.panY = this.pan.startY + event.clientY - this.pan.startClientY;
    this.apply();
    return true;
  }

  public endPan(pointerId: number): boolean {
    if (this.pan === null || this.pan.pointerId !== pointerId) return false;
    this.pan = null;
    return true;
  }

  public cancelPan(pointerId?: number): void {
    if (pointerId === undefined || this.pan?.pointerId === pointerId) this.pan = null;
  }

  public zoomAt(event: WheelEvent, stage: HTMLElement): void {
    const bounds = stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const worldX = (x - this.panX) / this.zoomValue;
    const worldY = (y - this.panY) / this.zoomValue;
    this.zoomValue = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, this.zoomValue * Math.exp(-event.deltaY * 0.0012))
    );
    this.panX = x - worldX * this.zoomValue;
    this.panY = y - worldY * this.zoomValue;
    this.apply();
  }

  public toWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const stage = this.host.querySelector<HTMLElement>('[data-role="graph-stage"]');
    if (stage === null) return null;
    const bounds = stage.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - this.panX) / this.zoomValue,
      y: (clientY - bounds.top - this.panY) / this.zoomValue
    };
  }

  public fit(graph: Readonly<SurfaceGraphDefinition>): void {
    const stage = this.host.querySelector<HTMLElement>('[data-role="graph-stage"]');
    const nodeElements = Array.from(this.host.querySelectorAll<HTMLElement>('[data-graph-node]'));
    if (stage === null || nodeElements.length === 0) return;

    const outputPosition = graphOutputPosition(graph);
    const worldRects = nodeElements.map((element) => {
      const nodeId = element.dataset.graphNode;
      const node = nodeId === GRAPH_VIRTUAL_OUTPUT_ID
        ? null
        : graph.nodes.find((item) => item.id === nodeId) ?? null;
      const position = node?.position ?? outputPosition;
      return { x: position.x, y: position.y, width: element.offsetWidth, height: element.offsetHeight };
    });
    const minX = Math.min(...worldRects.map((rect) => rect.x));
    const minY = Math.min(...worldRects.map((rect) => rect.y));
    const maxX = Math.max(...worldRects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...worldRects.map((rect) => rect.y + rect.height));
    const graphWidth = Math.max(maxX - minX, 1);
    const graphHeight = Math.max(maxY - minY, 1);
    const sidePanelWidth = this.host.querySelector<HTMLElement>('.sg-side-panel')?.offsetWidth ?? 0;
    const availableWidth = Math.max(stage.clientWidth - sidePanelWidth - FIT_PADDING * 2, 120);
    const availableHeight = Math.max(stage.clientHeight - FIT_PADDING * 2, 120);

    this.zoomValue = Math.max(
      MIN_ZOOM,
      Math.min(MAX_FIT_ZOOM, availableWidth / graphWidth, availableHeight / graphHeight)
    );
    this.panX = FIT_PADDING + (availableWidth - graphWidth * this.zoomValue) * 0.5 - minX * this.zoomValue;
    this.panY = FIT_PADDING + (availableHeight - graphHeight * this.zoomValue) * 0.5 - minY * this.zoomValue;
    this.apply();
  }

  public apply(): void {
    const world = this.host.querySelector<HTMLElement>('[data-role="graph-world"]');
    if (world !== null) world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomValue})`;

    const grid = this.host.querySelector<HTMLElement>('.sg-grid');
    if (grid !== null) {
      grid.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
      grid.style.backgroundSize = `${GRID_SIZE * this.zoomValue}px ${GRID_SIZE * this.zoomValue}px`;
    }

    const zoomLabel = this.host.querySelector<HTMLElement>('[data-role="graph-zoom"]');
    if (zoomLabel !== null) zoomLabel.textContent = `${Math.round(this.zoomValue * 100)}%`;
    this.onTransform();
  }
}
