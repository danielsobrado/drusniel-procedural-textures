export type ImportedFileLookup =
  | { status: 'found'; file: File }
  | { status: 'ambiguous' }
  | { status: 'missing' };

function sameFileMetadata(left: File, right: File): boolean {
  return left.name === right.name &&
    left.size === right.size &&
    left.lastModified === right.lastModified &&
    left.type === right.type;
}

export class ImportedFileCache {
  private readonly files = new Map<string, File>();
  private readonly ambiguousNames = new Set<string>();
  private totalBytes = 0;

  public constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number
  ) {}

  public remember(file: File): void {
    const existing = this.files.get(file.name);
    if (existing !== undefined && !sameFileMetadata(existing, file)) {
      this.remove(file.name);
      this.ambiguousNames.add(file.name);
      return;
    }

    if (this.ambiguousNames.has(file.name)) {
      return;
    }

    if (existing !== undefined) {
      this.files.delete(file.name);
      this.files.set(file.name, existing);
      return;
    }

    this.files.set(file.name, file);
    this.totalBytes += file.size;
    this.evictToLimits();
  }

  public lookup(name: string): ImportedFileLookup {
    const file = this.files.get(name);
    if (file !== undefined) {
      return { status: 'found', file };
    }

    if (this.ambiguousNames.has(name)) {
      return { status: 'ambiguous' };
    }

    return { status: 'missing' };
  }

  public clear(): void {
    this.files.clear();
    this.ambiguousNames.clear();
    this.totalBytes = 0;
  }

  private evictToLimits(): void {
    while (this.files.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.files.keys().next();
      if (oldest.done) {
        break;
      }
      this.remove(oldest.value);
    }
  }

  private remove(name: string): void {
    const file = this.files.get(name);
    if (file === undefined) {
      return;
    }

    this.files.delete(name);
    this.totalBytes -= file.size;
  }
}
