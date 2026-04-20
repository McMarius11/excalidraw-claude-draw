export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function shrink(box: Box, pad: number): Box {
  return {
    x: box.x + pad,
    y: box.y + pad,
    w: Math.max(0, box.w - pad * 2),
    h: Math.max(0, box.h - pad * 2),
  };
}

export function splitMain(
  inner: Box,
  axis: 'x' | 'y',
  explicitSizes: (number | undefined)[],
  gap: number
): { offset: number; size: number }[] {
  const total = axis === 'x' ? inner.w : inner.h;
  const count = explicitSizes.length;
  if (count === 0) return [];
  const gapTotal = gap * Math.max(0, count - 1);
  const fixedSum = explicitSizes.reduce<number>((a, b) => a + (b ?? 0), 0);
  const flexCount = explicitSizes.filter((s) => s === undefined).length;
  const flexRemainder = Math.max(0, total - fixedSum - gapTotal);
  const flexSize = flexCount > 0 ? Math.floor(flexRemainder / flexCount) : 0;

  const out: { offset: number; size: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const size = explicitSizes[i] ?? flexSize;
    out.push({ offset: cursor, size });
    cursor += size + gap;
  }
  return out;
}
