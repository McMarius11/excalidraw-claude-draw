import type { DslNode } from './types.ts';
import { DslParseError } from './types.ts';
import { rect, ellipse, txt, arrow, resetIds } from './primitives.ts';
import { parseDsl } from './parser.ts';
import { shrink, splitMain, type Box } from './layout.ts';

export const DEFAULT_ROOT_BOX: Box = { x: 0, y: 0, w: 1540, h: 900 };

export type Handler = (node: DslNode, box: Box, ctx: unknown, els: unknown[]) => void;

export interface CompileOptions {
  extraHandlers?: Record<string, Handler>;
  ctx?: unknown;
}

function num(n: DslNode, key: string, dflt?: number): number {
  const v = n.attrs[key];
  if (v === undefined) {
    if (dflt === undefined) throw new Error(`<${n.type}> missing required numeric attr "${key}"`);
    return dflt;
  }
  if (typeof v !== 'number') throw new Error(`<${n.type}> attr "${key}" must be number, got ${typeof v}`);
  return v;
}

function numOpt(n: DslNode, key: string): number | undefined {
  const v = n.attrs[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number') throw new Error(`<${n.type}> attr "${key}" must be number`);
  return v;
}

function str(n: DslNode, key: string, dflt?: string): string {
  const v = n.attrs[key];
  if (v === undefined) {
    if (dflt === undefined) throw new Error(`<${n.type}> missing required string attr "${key}"`);
    return dflt;
  }
  if (typeof v !== 'string') throw new Error(`<${n.type}> attr "${key}" must be string, got ${typeof v}`);
  return v;
}

function strOpt(n: DslNode, key: string): string | undefined {
  const v = n.attrs[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`<${n.type}> attr "${key}" must be string`);
  return v;
}

function boolOpt(n: DslNode, key: string, dflt: boolean): boolean {
  const v = n.attrs[key];
  if (v === undefined) return dflt;
  if (typeof v !== 'boolean') throw new Error(`<${n.type}> attr "${key}" must be boolean`);
  return v;
}

function resolveBox(n: DslNode, parent: Box): Box {
  return {
    x: numOpt(n, 'x') ?? parent.x,
    y: numOpt(n, 'y') ?? parent.y,
    w: numOpt(n, 'w') ?? parent.w,
    h: numOpt(n, 'h') ?? parent.h,
  };
}

const CONTAINER_TYPES = new Set(['row', 'col', 'stack', 'group']);

const leafHandlers: Record<string, Handler> = {
  rect(n, box, _c, els) {
    const b = resolveBox(n, box);
    els.push(
      rect({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        bg: strOpt(n, 'bg'),
        stroke: strOpt(n, 'stroke'),
        sw: numOpt(n, 'sw'),
        round: boolOpt(n, 'round', true),
      })
    );
  },

  ellipse(n, box, _c, els) {
    const b = resolveBox(n, box);
    els.push(
      ellipse({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        bg: strOpt(n, 'bg'),
        stroke: strOpt(n, 'stroke'),
        sw: numOpt(n, 'sw'),
      })
    );
  },

  txt(n, box, _c, els) {
    const b = resolveBox(n, box);
    const text = n.body ?? str(n, 'text', '');
    const align = strOpt(n, 'align') as 'left' | 'center' | 'right' | undefined;
    const vAlign = strOpt(n, 'vAlign') as 'top' | 'middle' | 'bottom' | undefined;
    els.push(
      txt({
        x: b.x,
        y: b.y,
        w: b.w,
        h: numOpt(n, 'h') ?? 20,
        text,
        size: numOpt(n, 'size'),
        color: strOpt(n, 'color'),
        align,
        vAlign,
      })
    );
  },

  arrow(n, _box, _c, els) {
    els.push(
      arrow({
        x1: num(n, 'x1'),
        y1: num(n, 'y1'),
        x2: num(n, 'x2'),
        y2: num(n, 'y2'),
        stroke: strOpt(n, 'stroke'),
        sw: numOpt(n, 'sw'),
      })
    );
  },
};

function compileNode(
  node: DslNode,
  box: Box,
  ctx: unknown,
  els: unknown[],
  registry: Record<string, Handler>
): void {
  if (node.type === 'group') {
    const b = resolveBox(node, box);
    for (const child of node.children ?? []) compileNode(child, b, ctx, els, registry);
    return;
  }

  if (node.type === 'row') {
    const outer = resolveBox(node, box);
    const pad = num(node, 'pad', 0);
    const gap = num(node, 'gap', 0);
    const inner = shrink(outer, pad);
    const children = node.children ?? [];
    const explicitW = children.map((c) => numOpt(c, 'w'));
    const slots = splitMain(inner, 'x', explicitW, gap);
    children.forEach((child, i) => {
      const { offset, size } = slots[i];
      const childBox: Box = {
        x: inner.x + offset,
        y: inner.y,
        w: size,
        h: numOpt(child, 'h') ?? inner.h,
      };
      compileNode(child, childBox, ctx, els, registry);
    });
    return;
  }

  if (node.type === 'col') {
    const outer = resolveBox(node, box);
    const pad = num(node, 'pad', 0);
    const gap = num(node, 'gap', 0);
    const inner = shrink(outer, pad);
    const children = node.children ?? [];
    const explicitH = children.map((c) => numOpt(c, 'h'));
    const slots = splitMain(inner, 'y', explicitH, gap);
    children.forEach((child, i) => {
      const { offset, size } = slots[i];
      const childBox: Box = {
        x: inner.x,
        y: inner.y + offset,
        w: numOpt(child, 'w') ?? inner.w,
        h: size,
      };
      compileNode(child, childBox, ctx, els, registry);
    });
    return;
  }

  if (node.type === 'stack') {
    const outer = resolveBox(node, box);
    const pad = num(node, 'pad', 0);
    const inner = shrink(outer, pad);
    for (const child of node.children ?? []) compileNode(child, inner, ctx, els, registry);
    return;
  }

  const handler = registry[node.type];
  if (!handler) throw new Error(`unknown DSL component "${node.type}"`);
  const resolved = resolveBox(node, box);
  handler(node, resolved, ctx, els);
  if (!CONTAINER_TYPES.has(node.type) && node.children) {
    for (const child of node.children) compileNode(child, resolved, ctx, els, registry);
  }
}

export function compile(
  nodes: DslNode[],
  options: CompileOptions = {},
  rootBox: Box = DEFAULT_ROOT_BOX
): unknown[] {
  resetIds();
  const registry = options.extraHandlers
    ? { ...leafHandlers, ...options.extraHandlers }
    : leafHandlers;
  const els: unknown[] = [];
  for (const n of nodes) compileNode(n, rootBox, options.ctx, els, registry);
  return els;
}

export function compileFromSource(
  src: string,
  options: CompileOptions = {},
  rootBox?: Box
): unknown[] {
  try {
    const nodes = parseDsl(src);
    return compile(nodes, options, rootBox);
  } catch (e) {
    if (e instanceof DslParseError) throw e;
    throw e;
  }
}

export function builtinComponents(): string[] {
  return [...Object.keys(leafHandlers), ...CONTAINER_TYPES].sort();
}
