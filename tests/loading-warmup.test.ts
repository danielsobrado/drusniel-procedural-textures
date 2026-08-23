import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rendererSource = readFileSync(new URL('../src/engine/LabRenderer.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
const environmentSource = readFileSync(new URL('../src/engine/EnvironmentLibrary.ts', import.meta.url), 'utf8');
const profilerSource = readFileSync(new URL('../src/engine/PerformanceProfiler.ts', import.meta.url), 'utf8');
const refinementStyles = readFileSync(new URL('../src/styles/refinements.css', import.meta.url), 'utf8');

describe('nonblocking renderer warmup', () => {
  it('does not generate the studio PMREM synchronously in the environment constructor', () => {
    const constructorBody = environmentSource.match(/public constructor\([^]*?\n  }/)?.[0] ?? '';
    expect(constructorBody).not.toContain('fromScene');
    expect(environmentSource).toContain('public async prepareStudio(): Promise<void>');
  });

  it('uses asynchronous shader compilation without treating failures as compiled programs', () => {
    expect(rendererSource).toContain('this.renderer.compileAsync(this.scene, this.camera)');
    expect(rendererSource).toContain('private materialCompileFailure: MaterialCompileFailure | null = null;');
    expect(rendererSource).toContain("throw new Error('Material shader compilation failed.'");
    expect(rendererSource).toContain('this.currentMaterialCompileFailure() !== null');
  });

  it('excludes warmup stalls from steady-state performance samples', () => {
    expect(profilerSource).toContain('public reset(now = performance.now()): void');
    expect(rendererSource).toContain('this.profiler.reset();');
  });

  it('waits for material readiness before saving a viewport snapshot', () => {
    expect(rendererSource).toContain('public async capturePng(): Promise<string>');
    expect(appSource).toContain('const dataUrl = await this.renderer.capturePng();');
  });

  it('keeps a visible viewport warmup state while expensive startup work runs', () => {
    expect(rendererSource).toContain("this.container.classList.toggle('is-loading', label !== null)");
    expect(refinementStyles).toContain('.viewport.is-loading::before');
    expect(refinementStyles).toContain('content: attr(data-loading-label)');
  });
});
