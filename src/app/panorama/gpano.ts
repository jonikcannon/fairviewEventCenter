// Reads the Google "Photo Sphere" (GPano) XMP block that phones write into
// panorama photos, so the viewer knows how much of the world the photo
// actually covers instead of guessing from its shape. Phone panorama mode
// produces a *partial* cylindrical panorama -- e.g. 6480px of a notional
// 26500px-wide 360, about 88 degrees across -- which is neither a flat photo
// nor a full sphere.
export type PanoGeometry = {
  mode: 'partial' | '360';
  // Degrees. Omitted for '360' (always 360 x 180).
  haov?: number;
  vaov?: number;
  // Vertical centre of the photo relative to the horizon, in degrees.
  vOffset?: number;
};

function readNumber(xmp: string, name: string): number | null {
  // XMP writes each property either as an attribute (GPano:Name="123") or as
  // an element (<GPano:Name>123</GPano:Name>).
  const match = new RegExp(`GPano:${name}(?:="|>)\\s*([-\\d.]+)`).exec(xmp);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function parseGPano(xmp: string): PanoGeometry | null {
  const projection = /GPano:ProjectionType(?:="|>)\s*([a-z]+)/i.exec(xmp)?.[1]?.toLowerCase();
  const fullW = readNumber(xmp, 'FullPanoWidthPixels');
  const croppedW = readNumber(xmp, 'CroppedAreaImageWidthPixels');
  const croppedH = readNumber(xmp, 'CroppedAreaImageHeightPixels');
  if (!projection || !fullW || !croppedW || !croppedH) return null;

  // Whole sphere: nothing to describe.
  if (croppedW >= fullW * 0.99) return { mode: '360' };

  const pxPerDegree = fullW / 360;
  const haov = croppedW / pxPerDegree;
  // A cylindrical projection keeps a constant pixels-per-degree horizontally
  // but vertical distance grows with tan(angle) from a cylinder of radius
  // fullW / 2pi; equirectangular is linear both ways.
  const vaov = projection === 'cylindrical'
    ? 2 * (Math.atan(croppedH / 2 / (fullW / (2 * Math.PI))) * 180) / Math.PI
    : croppedH / pxPerDegree;

  let vOffset = 0;
  const fullH = readNumber(xmp, 'FullPanoHeightPixels');
  const top = readNumber(xmp, 'CroppedAreaTopPixels');
  if (fullH && top !== null && projection !== 'cylindrical') {
    vOffset = (fullH / 2 - (top + croppedH / 2)) / pxPerDegree;
  }
  return { mode: 'partial', haov: round(Math.min(360, haov)), vaov: round(Math.min(180, vaov)), vOffset: round(vOffset) };
}

// The XMP packet sits near the start of the file, so only the head is read.
export async function readPanoGeometry(file: File): Promise<PanoGeometry | null> {
  try {
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    return parseGPano(new TextDecoder('latin1').decode(head));
  } catch {
    return null;
  }
}
