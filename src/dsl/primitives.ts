let _nonce = 1000;
let _id = 0;

export const nextNonce = () => ++_nonce;
export const newId = (prefix = 'el') => `${prefix}-${++_id}`;

export function resetIds() {
  _id = 0;
  _nonce = 1000;
}

export function base(id: string) {
  return {
    version: 1,
    versionNonce: nextNonce(),
    isDeleted: false,
    id,
    fillStyle: 'solid' as const,
    strokeWidth: 1,
    strokeStyle: 'solid' as const,
    roughness: 0,
    opacity: 100,
    angle: 0,
    strokeColor: '#2a2f3a',
    backgroundColor: 'transparent',
    seed: nextNonce(),
    groupIds: [] as string[],
    frameId: null as null,
    roundness: null as null | { type: 3 },
    boundElements: [] as unknown[],
    updated: 1,
    link: null as null,
    locked: false,
  };
}

export interface RectArgs {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke?: string;
  bg?: string;
  sw?: number;
  round?: boolean;
}

export function rect({ x, y, w, h, stroke, bg, sw, round = true }: RectArgs) {
  return {
    type: 'rectangle' as const,
    ...base(newId('rect')),
    x,
    y,
    width: w,
    height: h,
    roundness: round ? { type: 3 as const } : null,
    ...(stroke ? { strokeColor: stroke } : {}),
    ...(bg ? { backgroundColor: bg } : {}),
    ...(sw !== undefined ? { strokeWidth: sw } : {}),
  };
}

export interface EllipseArgs {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke?: string;
  bg?: string;
  sw?: number;
}

export function ellipse({ x, y, w, h, stroke, bg, sw }: EllipseArgs) {
  return {
    type: 'ellipse' as const,
    ...base(newId('ell')),
    x,
    y,
    width: w,
    height: h,
    roundness: null,
    ...(stroke ? { strokeColor: stroke } : {}),
    ...(bg ? { backgroundColor: bg } : {}),
    ...(sw !== undefined ? { strokeWidth: sw } : {}),
  };
}

export interface TextArgs {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  family?: 1 | 2 | 3;
}

export function txt({
  x,
  y,
  w,
  h,
  text: body,
  size = 14,
  color = '#e4e7ec',
  align = 'left',
  vAlign = 'top',
  family = 2,
}: TextArgs) {
  return {
    type: 'text' as const,
    ...base(newId('text')),
    strokeColor: color,
    x,
    y,
    width: w,
    height: h,
    text: body,
    fontSize: size,
    fontFamily: family,
    textAlign: align,
    verticalAlign: vAlign,
    baseline: Math.round(size * 0.85),
    containerId: null,
    originalText: body,
    lineHeight: 1.25,
    autoResize: false,
  };
}

export interface ArrowArgs {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  sw?: number;
}

export function arrow({ x1, y1, x2, y2, stroke, sw }: ArrowArgs) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return {
    type: 'arrow' as const,
    ...base(newId('arrow')),
    x: x1,
    y: y1,
    width: Math.max(1, Math.abs(dx)),
    height: Math.max(1, Math.abs(dy)),
    ...(stroke ? { strokeColor: stroke } : {}),
    backgroundColor: 'transparent',
    roundness: { type: 2 as const },
    points: [
      [0, 0],
      [dx, dy],
    ],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow' as const,
    lastCommittedPoint: null,
    ...(sw !== undefined ? { strokeWidth: sw } : {}),
  };
}
