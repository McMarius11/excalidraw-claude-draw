import { DslParseError, type DslNode, type DslValue } from './types.ts';

type TokKind =
  | 'ident'
  | 'string'
  | 'number'
  | 'bool'
  | 'color'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'equals'
  | 'eof';

interface Tok {
  kind: TokKind;
  value: string;
  line: number;
  col: number;
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (kind: TokKind, value: string, l: number, c: number) =>
    toks.push({ kind, value, line: l, col: c });

  const peek = (n = 0) => src[i + n];
  const advance = () => {
    const ch = src[i++];
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < src.length) {
    const ch = src[i];
    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance();
      continue;
    }
    // comments — line: //... and block: /* ... */
    if (ch === '/' && peek(1) === '/') {
      while (i < src.length && src[i] !== '\n') advance();
      continue;
    }
    if (ch === '/' && peek(1) === '*') {
      advance();
      advance();
      while (i < src.length && !(src[i] === '*' && peek(1) === '/')) advance();
      if (i < src.length) {
        advance();
        advance();
      }
      continue;
    }

    const sl = line;
    const sc = col;

    if (ch === '{') {
      advance();
      push('lbrace', '{', sl, sc);
      continue;
    }
    if (ch === '}') {
      advance();
      push('rbrace', '}', sl, sc);
      continue;
    }
    if (ch === '[') {
      advance();
      push('lbracket', '[', sl, sc);
      continue;
    }
    if (ch === ']') {
      advance();
      push('rbracket', ']', sl, sc);
      continue;
    }
    if (ch === ',') {
      advance();
      push('comma', ',', sl, sc);
      continue;
    }
    if (ch === '=') {
      advance();
      push('equals', '=', sl, sc);
      continue;
    }

    // string
    if (ch === '"') {
      advance();
      let out = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          advance();
          const esc = advance();
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
        } else {
          out += advance();
        }
      }
      if (i >= src.length) throw new DslParseError('unterminated string', sl, sc);
      advance();
      push('string', out, sl, sc);
      continue;
    }

    // color #abc or #aabbcc or #aabbccdd
    if (ch === '#') {
      advance();
      let hex = '#';
      while (i < src.length && /[0-9a-fA-F]/.test(src[i])) hex += advance();
      if (hex.length < 4) throw new DslParseError(`bad color literal "${hex}"`, sl, sc);
      push('color', hex, sl, sc);
      continue;
    }

    // number (incl. negative)
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(peek(1) ?? ''))) {
      let num = '';
      if (ch === '-') num += advance();
      while (i < src.length && /[0-9.]/.test(src[i])) num += advance();
      push('number', num, sl, sc);
      continue;
    }

    // identifier or boolean
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < src.length && /[a-zA-Z0-9_-]/.test(src[i])) id += advance();
      if (id === 'true' || id === 'false') push('bool', id, sl, sc);
      else push('ident', id, sl, sc);
      continue;
    }

    throw new DslParseError(`unexpected char "${ch}"`, sl, sc);
  }

  push('eof', '', line, col);
  return toks;
}

class TokStream {
  private pos = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(n = 0): Tok {
    return this.toks[this.pos + n] ?? this.toks[this.toks.length - 1];
  }
  next(): Tok {
    return this.toks[this.pos++] ?? this.toks[this.toks.length - 1];
  }
  expect(kind: TokKind): Tok {
    const t = this.next();
    if (t.kind !== kind) {
      throw new DslParseError(
        `expected ${kind} but got ${t.kind} "${t.value}"`,
        t.line,
        t.col
      );
    }
    return t;
  }
  eof(): boolean {
    return this.peek().kind === 'eof';
  }
}

function parseValue(ts: TokStream): DslValue {
  const t = ts.peek();
  if (t.kind === 'string') return ts.next().value;
  if (t.kind === 'color') return ts.next().value;
  if (t.kind === 'number') {
    const raw = ts.next().value;
    const n = Number(raw);
    if (Number.isNaN(n)) throw new DslParseError(`bad number "${raw}"`, t.line, t.col);
    return n;
  }
  if (t.kind === 'bool') return ts.next().value === 'true';
  if (t.kind === 'ident') return ts.next().value;
  if (t.kind === 'lbracket') {
    ts.next();
    const items: DslValue[] = [];
    while (ts.peek().kind !== 'rbracket') {
      items.push(parseValue(ts));
      if (ts.peek().kind === 'comma') ts.next();
      else break;
    }
    ts.expect('rbracket');
    return items;
  }
  throw new DslParseError(`expected value but got ${t.kind} "${t.value}"`, t.line, t.col);
}

function parseAttrs(ts: TokStream): Record<string, DslValue> {
  const attrs: Record<string, DslValue> = {};
  while (ts.peek().kind === 'ident' && ts.peek(1).kind === 'equals') {
    const key = ts.next().value;
    ts.expect('equals');
    attrs[key] = parseValue(ts);
  }
  return attrs;
}

function parseNode(ts: TokStream): DslNode {
  const head = ts.expect('ident');
  const attrs = parseAttrs(ts);
  const node: DslNode = { type: head.value, attrs };

  // optional text body: a bare string literal immediately after attrs
  if (ts.peek().kind === 'string') {
    node.body = ts.next().value;
  }

  if (ts.peek().kind === 'lbrace') {
    ts.next();
    const children: DslNode[] = [];
    while (ts.peek().kind !== 'rbrace') {
      if (ts.eof()) {
        throw new DslParseError('unterminated block', ts.peek().line, ts.peek().col);
      }
      children.push(parseNode(ts));
    }
    ts.expect('rbrace');
    node.children = children;
  }
  return node;
}

export function parseDsl(src: string): DslNode[] {
  const ts = new TokStream(tokenize(src));
  const nodes: DslNode[] = [];
  while (!ts.eof()) {
    nodes.push(parseNode(ts));
  }
  return nodes;
}
