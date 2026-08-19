export type ImportedFileLookup =
  | { status: 'found'; files: readonly File[] }
  | { status: 'missing' };

interface FileMetadata {
  path: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
}

interface BundleEntry {
  files: readonly File[];
  bytes: number;
}

function filePath(file: File): string {
  const relativePath = file.webkitRelativePath.trim();
  return relativePath.length > 0 ? relativePath.replaceAll('\\', '/') : file.name;
}

function metadataOf(file: File): FileMetadata {
  return {
    path: filePath(file),
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type
  };
}

function bundleMetadata(files: readonly File[]): FileMetadata[] {
  return files
    .map(metadataOf)
    .sort((left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name));
}

function sameMetadata(left: readonly FileMetadata[], right: readonly FileMetadata[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined &&
      item.path === other.path &&
      item.name === other.name &&
      item.size === other.size &&
      item.lastModified === other.lastModified &&
      item.type === other.type;
  });
}

export class ImportedFileCache {
  private readonly bundles = new Map<string, BundleEntry>();
  private readonly knownMetadata = new Map<string, readonly FileMetadata[]>();
  private totalBytes = 0;

  public constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number
  ) {}

  public remember(primaryName: string, files: readonly File[]): void {
    if (files.length === 0) {
      throw new Error('Imported asset bundle cannot be empty.');
    }

    const metadata = bundleMetadata(files);
    const known = this.knownMetadata.get(primaryName);
    if (known !== undefined && !sameMetadata(known, metadata)) {
      throw new Error(
        `A different imported asset is already known as "${primaryName}". Rename the primary file before importing it so project history can restore the correct model.`
      );
    }

    this.rememberMetadata(primaryName, known ?? metadata);
    const existing = this.bundles.get(primaryName);
    if (existing !== undefined) {
      this.refreshBundle(primaryName, existing);
      return;
    }

    const bytes = files.reduce((total, file) => total + file.size, 0);
    this.bundles.set(primaryName, { files: [...files], bytes });
    this.totalBytes += bytes;
    this.evictToLimits();
  }

  public lookup(name: string): ImportedFileLookup {
    const bundle = this.bundles.get(name);
    if (bundle === undefined) {
      return { status: 'missing' };
    }
    this.refreshBundle(name, bundle);
    const metadata = this.knownMetadata.get(name);
    if (metadata !== undefined) {
      this.rememberMetadata(name, metadata);
    }
    return { status: 'found', files: bundle.files };
  }

  public clear(): void {
    this.bundles.clear();
    this.knownMetadata.clear();
    this.totalBytes = 0;
  }

  private rememberMetadata(name: string, metadata: readonly FileMetadata[]): void {
    this.knownMetadata.delete(name);
    this.knownMetadata.set(name, metadata);
    while (this.knownMetadata.size > this.maxEntries) {
      const oldest = this.knownMetadata.keys().next();
      if (oldest.done) {
        break;
      }
      this.knownMetadata.delete(oldest.value);
    }
  }

  private refreshBundle(name: string, bundle: BundleEntry): void {
    this.bundles.delete(name);
    this.bundles.set(name, bundle);
  }

  private evictToLimits(): void {
    while (this.bundles.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.bundles.keys().next();
      if (oldest.done) {
        break;
      }
      this.removeBundle(oldest.value);
    }
  }

  private removeBundle(name: string): void {
    const bundle = this.bundles.get(name);
    if (bundle === undefined) {
      return;
    }
    this.bundles.delete(name);
    this.totalBytes -= bundle.bytes;
  }
}
