const DATA_URI = /^data:/i;
const REMOTE_URI = /^(?:https?:|file:|blob:|\/\/)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || asRecord(value) !== null;
}

function stripUriSuffix(value: string): string {
  const queryIndex = value.indexOf('?');
  const fragmentIndex = value.indexOf('#');
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const end = indexes.length === 0 ? value.length : Math.min(...indexes);
  return value.slice(0, end);
}

function decodeResourcePath(value: string): string {
  const resourcePath = stripUriSuffix(value).replaceAll('\\', '/');
  try {
    return decodeURIComponent(resourcePath);
  } catch {
    return resourcePath;
  }
}

export function canonicalPath(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack.at(-1) !== '..') stack.pop();
      else stack.push('..');
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

export function canonicalResourcePath(value: string): string {
  return canonicalPath(decodeResourcePath(value));
}

function canonicalLocalPath(value: string): string {
  return canonicalPath(value);
}

export function isRemoteResourceUri(value: string): boolean {
  return REMOTE_URI.test(decodeResourcePath(value));
}

export function collectExternalUris(value: unknown): string[] {
  const uris = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current.filter(isContainer));
      continue;
    }
    const record = asRecord(current);
    if (record === null) continue;
    for (const [key, child] of Object.entries(record)) {
      if (key === 'uri' && typeof child === 'string' && !DATA_URI.test(child)) {
        if (isRemoteResourceUri(child)) throw new Error(`Remote GLTF resource URIs are not supported: ${child}`);
        uris.add(child);
      } else if (isContainer(child)) {
        pending.push(child);
      }
    }
  }
  return [...uris];
}

function basename(value: string): string {
  return value.split('/').at(-1) ?? '';
}

function dirname(value: string): string {
  const slash = value.lastIndexOf('/');
  return slash < 0 ? '' : value.slice(0, slash);
}

function joinBundlePath(base: string, relative: string): string {
  return canonicalPath(base.length === 0 ? relative : `${base}/${relative}`);
}

function bundleKeys(file: File): string[] {
  const relative = file.webkitRelativePath?.trim();
  return relative === undefined || relative.length === 0
    ? [canonicalLocalPath(file.name)]
    : [canonicalLocalPath(relative), canonicalLocalPath(file.name)];
}

export function createBundleIndex(files: readonly File[]): Map<string, File[]> {
  const index = new Map<string, File[]>();
  for (const file of files) {
    for (const key of bundleKeys(file)) {
      const values = index.get(key) ?? [];
      if (!values.includes(file)) values.push(file);
      index.set(key, values);
    }
  }
  return index;
}

export function primaryBundlePath(primary: File, index: ReadonlyMap<string, File[]>): string {
  const primaryName = canonicalLocalPath(primary.name);
  for (const [path, files] of index) {
    if (files.includes(primary) && path !== primaryName) return path;
  }
  return primaryName;
}

export function resolveBundleFile(
  uri: string,
  index: ReadonlyMap<string, File[]>,
  primaryPath: string
): File {
  if (isRemoteResourceUri(uri)) throw new Error(`Remote GLTF resource URIs are not supported: ${uri}`);
  const normalized = canonicalResourcePath(uri);
  const primaryRelative = joinBundlePath(dirname(primaryPath), normalized);
  for (const candidate of [primaryRelative, normalized]) {
    const exact = index.get(candidate);
    if (exact?.length === 1 && exact[0] !== undefined) return exact[0];
    if ((exact?.length ?? 0) > 1) throw new Error(`GLTF resource "${uri}" is ambiguous in the selected bundle.`);
  }

  const wantedBasename = basename(normalized);
  const matches = new Set<File>();
  for (const [path, files] of index) {
    if (basename(path) === wantedBasename) files.forEach((file) => matches.add(file));
  }
  if (matches.size === 1) return [...matches][0] as File;
  if (matches.size > 1) throw new Error(`GLTF resource "${uri}" is ambiguous in the selected bundle.`);
  throw new Error(`GLTF resource "${uri}" is missing. Select the GLTF, BIN and texture files together.`);
}

export function isDataUri(value: string): boolean {
  return DATA_URI.test(value);
}
