import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERRAIN_CONFIG } from '../src/config/terrainConfig';
import { ringSlotPosition, safeCenter } from '../src/ui/radialGeometry';

const RADIAL_SOURCE = readFileSync(
  new URL('../src/ui/MaterialRadialMenu.ts', import.meta.url),
  'utf8'
);
const MENU_SOURCE = readFileSync(
  new URL('../src/ui/RadialMenu.ts', import.meta.url),
  'utf8'
);
const PANEL_SOURCE = readFileSync(
  new URL('../src/ui/TerrainTileLabPanel.ts', import.meta.url),
  'utf8'
);
const CSS_SOURCE = readFileSync(
  new URL('../src/styles/terrain-tile-lab.css', import.meta.url),
  'utf8'
);
const TOUCH_SOURCE = readFileSync(
  new URL('../src/ui/TouchRadialTrigger.ts', import.meta.url),
  'utf8'
);
const PACKAGE_SOURCE = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const VISUAL_SOURCE = readFileSync(
  new URL('../scripts/terrain-game-context-visual.mjs', import.meta.url),
  'utf8'
);

describe('radial geometry', () => {
  it('starts at twelve o_clock and runs clockwise', () => {
    const top = ringSlotPosition(0, 4, 100);
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(-100, 6);
    const right = ringSlotPosition(1, 4, 100);
    expect(right.x).toBeCloseTo(100, 6);
    expect(right.y).toBeCloseTo(0, 6);
  });

  it('spaces slots evenly and tolerates an empty ring', () => {
    for (const count of [1, 3, 8, 12]) {
      const radii = Array.from({ length: count }, (_, index) => {
        const { x, y } = ringSlotPosition(index, count, 50);
        return Math.hypot(x, y);
      });
      for (const radius of radii) expect(radius).toBeCloseTo(50, 6);
    }
    expect(ringSlotPosition(0, 0, 100)).toEqual({ x: 0, y: 0 });
  });

  it('keeps a menu on screen without moving it more than necessary', () => {
    expect(safeCenter(500, 1000, 120)).toBe(500);
    expect(safeCenter(10, 1000, 120)).toBe(120);
    expect(safeCenter(990, 1000, 120)).toBe(880);
    // A margin larger than the viewport collapses to the centre rather than inverting.
    expect(safeCenter(10, 100, 400)).toBe(50);
  });

  it('is shared with the viewport radial rather than duplicated', () => {
    expect(MENU_SOURCE).toContain("from './radialGeometry'");
    expect(MENU_SOURCE).toContain('ringSlotPosition(');
    expect(MENU_SOURCE).not.toContain('Math.cos(angle) * ringRadius');
  });
});

describe('material radial picker', () => {
  it('leaves each band clear of its neighbours', () => {
    // Hub, inner ring and outer ring have to fit between the centre and the outer radius.
    // At the original 168px radius with a 176px hub the inner ring overlapped it by 27px.
    const outer = TERRAIN_CONFIG.radial.outerRadiusPx;
    const inner = outer * 0.5625;
    const hubHalfWidth = 150 / 2;
    const innerHalf = 48 / 2;
    const outerHalf = 72 / 2;
    expect(inner - innerHalf - hubHalfWidth).toBeGreaterThan(0);
    expect(outer - outerHalf - (inner + innerHalf)).toBeGreaterThan(0);
  });

  it('sizes petals above the touch-target minimum', () => {
    const perPage = TERRAIN_CONFIG.radial.presetsPerPage;
    const pitch = (2 * Math.PI * TERRAIN_CONFIG.radial.outerRadiusPx) / (perPage + 1);
    expect(pitch).toBeGreaterThan(72);
  });

  it('renders both rings at once instead of drilling down', () => {
    expect(RADIAL_SOURCE).toContain('role="radiogroup"');
    expect(RADIAL_SOURCE).toContain('role="listbox"');
    expect(RADIAL_SOURCE).toContain('role="dialog"');
    // Paged listbox positions must report the full filtered count, not the page size,
    // or assistive tech announces "3 of 11" for an entry that is 3 of 24.
    expect(RADIAL_SOURCE).toContain('aria-setsize="${total}"');
  });

  it('dwells before previewing so a sweep does not fetch every petal it crosses', () => {
    expect(RADIAL_SOURCE).toContain('TERRAIN_CONFIG.radial.hoverDwellMs');
    expect(TERRAIN_CONFIG.radial.hoverDwellMs).toBeGreaterThan(0);
  });

  it('commits through the native select so the existing assign path is reused', () => {
    expect(PANEL_SOURCE).toContain("select.dispatchEvent(new Event('change', { bubbles: true }))");
  });

  it('opens from the surface with a drag guard so right-drag still erases paint', () => {
    expect(PANEL_SOURCE).toContain('UI_CONFIG.radialClickMoveTolerancePx');
    expect(PANEL_SOURCE).toContain('this.meshPreview.pickTerrain(clientX, clientY)');
    expect(PANEL_SOURCE).toContain('pendingStroke');
    expect(PANEL_SOURCE).toContain("event.pointerType === 'touch' || event.button === 2");
  });

  it('keeps the native select reachable for tooling and assistive tech', () => {
    // Deleting it would break the Playwright visual harness, which drives selectOption.
    expect(PANEL_SOURCE).toContain('class="terrain-material-preset"');
    expect(PANEL_SOURCE).not.toContain('terrain-material-preset sr-only');
    expect(CSS_SOURCE).toContain('.terrain-material-preset select');
  });

  it('supports touch, focus management, ring switching and focus trapping', () => {
    expect(TOUCH_SOURCE).toContain('public dispose()');
    expect(PANEL_SOURCE).toContain('new TouchRadialTrigger');
    expect(RADIAL_SOURCE).toContain("case 'ArrowUp'");
    expect(RADIAL_SOURCE).toContain("case 'ArrowDown'");
    expect(RADIAL_SOURCE).toContain("event.key === 'Home'");
    expect(RADIAL_SOURCE).toContain("event.key === 'Tab'");
    expect(RADIAL_SOURCE).toContain('focusFirst = true');
  });

  it('runs the Tile Lab interaction and all-lighting capture in the visual gate', () => {
    expect(PACKAGE_SOURCE).toContain('node scripts/terrain-game-context-visual.mjs');
    for (const preset of ['dawn', 'morning', 'noon', 'golden', 'dusk', 'overcast', 'studio']) {
      expect(VISUAL_SOURCE).toContain(`'${preset}'`);
    }
    expect(VISUAL_SOURCE).toContain('data-radial-preview-preset');
    expect(VISUAL_SOURCE).toContain('Radial hover preview did not change the terrain canvas');
  });
});
