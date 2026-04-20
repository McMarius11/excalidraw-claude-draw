import { DslParseError, type DslNode, type DslValue } from './types.ts';

// LLMs (esp. Haiku on non-English prompts) regularly emit Unicode punctuation
// variants — en-dash, em-dash, curly quotes — that aren't part of the DSL
// grammar. Normalize to ASCII before tokenizing so a stray "Dashboard – Overview"
// doesn't turn into a parse error.
const PUNCTUATION_NORMALIZATION: Array<[RegExp, string]> = [
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'], // hyphens, en/em/figure dash, minus
  [/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"'],       // double smart/guillemet quotes
  [/[\u2018\u2019\u201A\u201B]/g, "'"],                   // single smart quotes
  [/\u2026/g, '...'],                                       // ellipsis
  [/\u00A0/g, ' '],                                         // non-breaking space
];

// Haiku sometimes wraps DSL output in a Markdown code fence (```dsl … ```)
// despite instructions to emit raw source. Strip leading/trailing fences so
// the wrapper doesn't reach the tokenizer as stray backticks.
function stripCodeFences(src: string): string {
  let out = src.replace(/^\s*```[^\n]*\n?/, '');
  out = out.replace(/\n?\s*```\s*$/, '');
  return out;
}

export function normalizeDslSource(src: string): string {
  let out = stripCodeFences(src);
  for (const [re, repl] of PUNCTUATION_NORMALIZATION) out = out.replace(re, repl);
  return out;
}

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

    // number (incl. negative). LLMs sometimes append CSS-style units
    // ("w=80%", "size=12px") — eat the suffix and discard so it doesn't
    // blow up tokenization. The numeric value is what matters downstream.
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(peek(1) ?? ''))) {
      let num = '';
      if (ch === '-') num += advance();
      while (i < src.length && /[0-9.]/.test(src[i])) num += advance();
      if (i < src.length && src[i] === '%') advance();
      else if (i + 1 < src.length && /[a-z]{2,3}/.test(src.slice(i, i + 3))) {
        const rest = src.slice(i);
        const m = rest.match(/^(px|pt|em|rem|vw|vh|deg)/);
        if (m) for (let k = 0; k < m[0].length; k++) advance();
      }
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

function parseNode(ts: TokStream): DslNode {
  const head = ts.expect('ident');
  const node: DslNode = { type: head.value, attrs: {} };

  // Accept attrs (ident=value) and an optional body string in any order.
  // Haiku frequently emits the body before or between attrs — e.g.
  // `txt "Title" size=20 color=#fff` or `txt h=30 "Title" size=20`.
  // Tolerating both orderings is cheaper than fighting the LLM.
  while (true) {
    const p = ts.peek();
    if (p.kind === 'ident' && ts.peek(1).kind === 'equals') {
      const key = ts.next().value;
      ts.expect('equals');
      node.attrs[key] = parseValue(ts);
      continue;
    }
    if (p.kind === 'string' && node.body === undefined) {
      node.body = ts.next().value;
      continue;
    }
    break;
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
  const ts = new TokStream(tokenize(normalizeDslSource(src)));
  const nodes: DslNode[] = [];
  while (!ts.eof()) {
    nodes.push(parseNode(ts));
  }
  return nodes;
}
