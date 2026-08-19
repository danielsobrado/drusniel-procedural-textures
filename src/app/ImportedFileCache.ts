export type ImportedFileLookup =
  | { status: 'found'; file: File }
  | { status: 'missing' };

interface FileMetadata {
  size: number;
  lastModified: number;
  type: string;
}

function metadataOf(file: File): FileMetadata {
  return {
    size: file.size,
    lastModified: file.lastModified,
    type: file.type
  };
}

function sameFileMetadata(metadata: FileMetadata, file: File): boolean {
  return metadata.size === file.size &&
    metadata.lastModified === file.lastModified &&
    metadata.type === file.type;
}

export class ImportedFileCache {
  private readonly files = new Map<string, File>();
  private readonly knownMetadata = new Map<string, FileMetadata>();
  private totalBytes = 0;

  public constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number
  ) {}

  public remember(file: File): void {
    const metadata = this.knownMetadata.get(file.name);
    if (metadata !== undefined && !sameFileMetadata(metadata, file)) {
      throw new Error(
        `A different imported asset is already known as "${file.name}". Rename the file before importing it so project history can restore the correct model.`
      );
    }

    this.rememberMetadata(file.name, metadata ?? metadataOf(file));

    const existing = this.files.get(file.name);
    if (existing !== undefined) {
      this.refreshFile(file.name, existing);
      return;
    }

    this.files.set(file.name, file);
    this.totalBytes += file.size;
    this.evictFilesToLimits();
  }

  public lookup(name: string): ImportedFileLookup {
    const file = this.files.get(name);
    if (file === undefined) {
      return { status: 'missing' };
    }

    this.refreshFile(name, file);
    const metadata = this.knownMetadata.get(name);
    if (metadata !== undefined) {
      this.rememberMetadata(name, metadata);
    }
    return { status: 'found', file };
  }

  public clear(): void {
    this.files.clear();
    this.knownMetadata.clear();
    this.totalBytes = 0;
  }

  private rememberMetadata(name: string, metadata: FileMetadata): void {
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

  private refreshFile(name: string, file: File): void {
    this.files.delete(name);
    this.files.set(name, file);
  }

  private evictFilesToLimits(): void {
    while (this.files.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.files.keys().next();
      if (oldest.done) {
        break;
      }
      this.removeFile(oldest.value);
    }
  }

  private removeFile(name: string): void {
    const file = this.files.get(name);
    if (file === undefined) {
      return;
    }

    this.files.delete(name);
    this.totalBytes -= file.size;
  }
}
