import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');

describe('project external asset restoration', () => {
  it('invalidates same-name cached external assets when opening project JSON', () => {
    expect(appSource).toContain('this.renderer.discardCustomEnvironment(normalizedProject.environmentAssetName);');
    expect(appSource).toContain('this.importedFiles.forget(normalizedProject.importedAssetName);');
    expect(appSource).toContain('Re-import ${normalizedProject.importedAssetName} to restore the model.');
  });
});
