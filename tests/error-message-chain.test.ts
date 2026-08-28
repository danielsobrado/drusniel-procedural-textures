import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');

/**
 * App.errorMessage is private and App needs a live DOM, so the behaviour is exercised through an
 * extracted copy of the same routine. The guard below keeps the two from drifting apart.
 */
function errorMessage(error: unknown): string {
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const message = current.message.trim();
    if (message.length > 0 && !chain.includes(message)) chain.push(message);
    current = current.cause;
  }
  return chain.length === 0 ? 'Unexpected error.' : chain.join(' · ');
}

describe('user-facing error messages', () => {
  it('keeps the extracted copy in step with App.errorMessage', () => {
    expect(appSource).toContain('for (let depth = 0; current instanceof Error && depth < 4; depth += 1)');
    expect(appSource).toContain("return chain.length === 0 ? 'Unexpected error.' : chain.join(' · ');");
  });

  it('reports the reason a wrapped failure gives, not just the stage label', () => {
    const cause = new Error('Could not initialize the KTX2 texture-field transcoder.');
    const error = new Error('Texture-field preparation failed.', { cause });

    expect(errorMessage(error)).toBe(
      'Texture-field preparation failed. · Could not initialize the KTX2 texture-field transcoder.'
    );
  });

  it('flattens a multi-level chain down to the root reason', () => {
    const root = new Error('Failed to fetch');
    const middle = new Error('Could not initialize the KTX2 texture-field transcoder.', { cause: root });
    const outer = new Error('Texture-field preparation failed.', { cause: middle });

    expect(errorMessage(outer)).toBe(
      'Texture-field preparation failed. · Could not initialize the KTX2 texture-field transcoder. · Failed to fetch'
    );
  });

  it('does not repeat a cause that restates its wrapper', () => {
    const error = new Error('Renderer is unavailable.', { cause: new Error('Renderer is unavailable.') });

    expect(errorMessage(error)).toBe('Renderer is unavailable.');
  });

  it('terminates on a self-referential cause', () => {
    const error = new Error('Looping failure.');
    (error as { cause?: unknown }).cause = error;

    expect(errorMessage(error)).toBe('Looping failure.');
  });

  it('falls back for non-errors and blank messages', () => {
    expect(errorMessage('boom')).toBe('Unexpected error.');
    expect(errorMessage(undefined)).toBe('Unexpected error.');
    expect(errorMessage(new Error('   '))).toBe('Unexpected error.');
  });
});
