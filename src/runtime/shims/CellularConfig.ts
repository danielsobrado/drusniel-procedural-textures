import { PTL_CELLULAR_DEFAULTS } from '../../core/material/runtimeDefaults';

export const cellularConfig = PTL_CELLULAR_DEFAULTS;

export function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
