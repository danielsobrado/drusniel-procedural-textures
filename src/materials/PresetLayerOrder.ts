import type { MaterialPreset } from './types';

export function placePresetLayerBefore(
  preset: MaterialPreset,
  sourceId: string,
  consumerId: string
): MaterialPreset {
  const sourceIndex = preset.layers.findIndex((layer) => layer.id === sourceId);
  const consumerIndex = preset.layers.findIndex((layer) => layer.id === consumerId);
  if (sourceIndex < 0) throw new Error(`Preset ${preset.id} is missing layer ${sourceId}.`);
  if (consumerIndex < 0) throw new Error(`Preset ${preset.id} is missing layer ${consumerId}.`);
  if (sourceIndex < consumerIndex) return preset;

  const layers = [...preset.layers];
  const [source] = layers.splice(sourceIndex, 1);
  if (source === undefined) throw new Error(`Preset ${preset.id} could not move layer ${sourceId}.`);
  const nextConsumerIndex = layers.findIndex((layer) => layer.id === consumerId);
  if (nextConsumerIndex < 0) throw new Error(`Preset ${preset.id} lost layer ${consumerId} while reordering.`);
  layers.splice(nextConsumerIndex, 0, source);
  return { ...preset, layers };
}
