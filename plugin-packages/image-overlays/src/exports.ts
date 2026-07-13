export function slugifyFilenamePart(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'overlay';
}

function dimension(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', '_');
}

export function pngFilename(elementId: string, width: number, height: number): string {
  return `${slugifyFilenamePart(elementId)}-${dimension(width)}x${dimension(height)}.png`;
}

export function maskZipFilename(elementId: string, width: number, height: number): string {
  return `${slugifyFilenamePart(elementId)}-${dimension(width)}x${dimension(height)}-masks.zip`;
}

export function maskFolderName(elementId: string, width: number, height: number): string {
  return `${slugifyFilenamePart(elementId)}-${dimension(width)}x${dimension(height)}-masks`;
}

export function maskFilename(index: number, label: string): string {
  return `${String(index + 1).padStart(2, '0')}-${slugifyFilenamePart(label)}.png`;
}
