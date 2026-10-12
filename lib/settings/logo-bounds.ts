export interface LogoBounds { left: number; top: number; width: number; height: number }

/** Find the visible artwork without changing the image file. */
export function logoBounds(pixels: Uint8ClampedArray, width: number, height: number): LogoBounds | null {
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  // A small inset keeps antialiased edges visible.
  left = Math.max(0, left - 1); top = Math.max(0, top - 1);
  right = Math.min(width - 1, right + 1); bottom = Math.min(height - 1, bottom + 1);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
