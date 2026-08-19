function clickDownload(filename: string, url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  clickDownload(filename, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(
  filename: string,
  content: string,
  mimeType = 'application/json'
): void {
  downloadBlob(filename, new Blob([content], { type: mimeType }));
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  clickDownload(filename, dataUrl);
}
