import { describe, expect, it } from 'vitest';
import { labConfig } from '../src/config/labConfig';
import { assertPortableConfigCompatibility } from '../src/config/PortableConfigValidation';

describe('portable runtime configuration', () => {
  it('keeps lab configuration aligned with runtime defaults and limits', () => {
    expect(() => assertPortableConfigCompatibility(labConfig)).not.toThrow();
  });
});
