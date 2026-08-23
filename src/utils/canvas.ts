export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('Browser failed to encode the PNG image.'));
      else resolve(blob);
    }, 'image/png');
  });
}

export async function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await canvasToPngBlob(canvas);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(new Error('Browser failed to read the encoded PNG image.')), {
      once: true
    });
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Browser returned an invalid encoded PNG image.'));
    }, { once: true });
    reader.readAsDataURL(blob);
  });
}
