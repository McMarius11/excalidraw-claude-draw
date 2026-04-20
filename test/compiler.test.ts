// Run: node --experimental-strip-types --no-warnings test/compiler.test.ts
import assert from 'node:assert/strict';
import { compile, compileFromSource, builtinComponents, type Handler } from '../src/dsl/compiler.ts';

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error('    ', e instanceof Error ? e.message : e);
    fail++;
  }
}

console.log('\n== DSL Compiler Tests ==\n');

test('builtins include layout + primitives', () => {
  const comps = builtinComponents();
  for (const expected of ['rect', 'ellipse', 'txt', 'arrow', 'group', 'row', 'col', 'stack']) {
    assert.ok(comps.includes(expected), `missing "${expected}"`);
  }
});

test('rect → 1 rectangle element', () => {
  const els = compileFromSource('rect x=10 y=20 w=100 h=50 bg=#3b82f6 stroke=#111') as Array<{
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    backgroundColor: string;
  }>;
  assert.equal(els.length, 1);
  assert.equal(els[0].type, 'rectangle');
  assert.equal(els[0].x, 10);
  assert.equal(els[0].y, 20);
  assert.equal(els[0].width, 100);
  assert.equal(els[0].height, 50);
  assert.equal(els[0].backgroundColor, '#3b82f6');
});

test('txt with body string', () => {
  const els = compileFromSource('txt x=0 y=0 w=200 h=22 size=14 "Hello"') as Array<{
    type: string;
    text: string;
    fontSize: number;
  }>;
  assert.equal(els.length, 1);
  assert.equal(els[0].type, 'text');
  assert.equal(els[0].text, 'Hello');
  assert.equal(els[0].fontSize, 14);
});

test('group container: children compile into flat array', () => {
  const els = compileFromSource(`
    group {
      rect x=0 y=0 w=10 h=10
      rect x=20 y=0 w=10 h=10
      rect x=40 y=0 w=10 h=10
    }
  `);
  assert.equal(els.length, 3);
});

test('arbitrary node with children recursively compiles both', () => {
  const els = compileFromSource(`
    rect x=0 y=0 w=100 h=100 {
      rect x=10 y=10 w=20 h=20
    }
  `);
  assert.equal(els.length, 2);
});

test('error: unknown component type', () => {
  assert.throws(() => compileFromSource('unknownThing x=0 y=0'), /unknown DSL component/);
});

test('error: wrong attr type', () => {
  assert.throws(() => compileFromSource('rect x=0 y=0 w="abc" h=10'), /must be number/);
});

test('compile(nodes) also works with pre-parsed AST', () => {
  const els = compile([
    { type: 'rect', attrs: { x: 0, y: 0, w: 10, h: 10 } },
    { type: 'rect', attrs: { x: 20, y: 0, w: 10, h: 10 } },
  ]);
  assert.equal(els.length, 2);
});

test('row: flex-splits equally within fixed width', () => {
  const dsl = `
    row x=0 y=0 w=1000 h=82 gap=10 {
      rect
      rect
      rect
      rect
    }
  `;
  const els = compileFromSource(dsl) as Array<{ x: number; width: number }>;
  assert.equal(els.length, 4);
  assert.equal(els[0].x, 0);
  const w = Math.floor((1000 - 3 * 10) / 4);
  assert.equal(els[0].width, w);
  assert.equal(els[1].x, w + 10);
});

test('row: explicit w on one child, flex fill on others', () => {
  const dsl = `
    row x=0 y=0 w=600 h=60 gap=0 {
      rect w=200
      rect
      rect
    }
  `;
  const els = compileFromSource(dsl) as Array<{ x: number; width: number }>;
  assert.equal(els.length, 3);
  assert.equal(els[0].width, 200);
  assert.equal(els[1].width, 200);
  assert.equal(els[2].width, 200);
  assert.equal(els[0].x, 0);
  assert.equal(els[1].x, 200);
  assert.equal(els[2].x, 400);
});

test('row: pad shrinks inner layout area', () => {
  const dsl = `
    row x=0 y=0 w=100 h=50 pad=10 gap=0 {
      rect
    }
  `;
  const els = compileFromSource(dsl) as Array<{ x: number; y: number; width: number; height: number }>;
  assert.equal(els[0].x, 10);
  assert.equal(els[0].y, 10);
  assert.equal(els[0].width, 80);
  assert.equal(els[0].height, 30);
});

test('col: vertical stacking with flex', () => {
  const dsl = `
    col x=0 y=0 w=200 h=300 gap=0 {
      rect h=100
      rect
      rect
    }
  `;
  const els = compileFromSource(dsl) as Array<{ y: number; height: number }>;
  assert.equal(els.length, 3);
  assert.equal(els[0].y, 0);
  assert.equal(els[0].height, 100);
  assert.equal(els[1].y, 100);
  assert.equal(els[1].height, 100);
  assert.equal(els[2].y, 200);
});

test('stack: overlay — all children share the same box', () => {
  const dsl = `
    stack x=0 y=0 w=300 h=200 {
      rect
      rect
    }
  `;
  const els = compileFromSource(dsl) as Array<{ x: number; y: number; width: number; height: number }>;
  assert.equal(els.length, 2);
  assert.deepEqual([els[0].x, els[0].y, els[0].width, els[0].height], [0, 0, 300, 200]);
  assert.deepEqual([els[1].x, els[1].y, els[1].width, els[1].height], [0, 0, 300, 200]);
});

test('nested col inside row', () => {
  const dsl = `
    row x=0 y=0 w=400 h=200 gap=0 {
      rect w=100
      col gap=0 {
        rect
        rect
      }
    }
  `;
  const els = compileFromSource(dsl) as Array<{ x: number; y: number; width: number; height: number }>;
  assert.equal(els.length, 3);
  assert.equal(els[0].width, 100);
  assert.equal(els[1].x, 100);
  assert.equal(els[1].width, 300);
  assert.equal(els[1].height, 100);
  assert.equal(els[2].y, 100);
  assert.equal(els[2].height, 100);
});

test('explicit child x/y overrides layout-computed position', () => {
  const dsl = `
    row x=0 y=0 w=400 h=50 gap=0 {
      rect
      rect x=999 y=999
    }
  `;
  const els = compileFromSource(dsl) as Array<{ x: number; y: number }>;
  assert.equal(els[1].x, 999);
  assert.equal(els[1].y, 999);
});

test('rootBox: top-level nodes inherit rootBox when attrs missing', () => {
  const els = compileFromSource('rect bg=#fff', {}, { x: 10, y: 20, w: 100, h: 200 }) as Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  assert.equal(els[0].x, 10);
  assert.equal(els[0].y, 20);
  assert.equal(els[0].width, 100);
  assert.equal(els[0].height, 200);
});

test('extraHandlers: register custom component', () => {
  const badge: Handler = (node, box, _ctx, els) => {
    els.push({ type: 'custom-badge', x: box.x, y: box.y, label: node.attrs.label });
  };
  const els = compileFromSource('badge x=5 y=7 label="NEW"', { extraHandlers: { badge } }) as Array<{
    type: string;
    x: number;
    y: number;
    label: string;
  }>;
  assert.equal(els.length, 1);
  assert.equal(els[0].type, 'custom-badge');
  assert.equal(els[0].x, 5);
  assert.equal(els[0].label, 'NEW');
});

test('extraHandlers: custom component works inside layout container', () => {
  const badge: Handler = (_node, box, _ctx, els) => {
    els.push({ type: 'custom-badge', x: box.x, y: box.y, w: box.w });
  };
  const dsl = `
    row x=0 y=0 w=300 h=20 gap=0 {
      badge label="a"
      badge label="b"
      badge label="c"
    }
  `;
  const els = compileFromSource(dsl, { extraHandlers: { badge } }) as Array<{ x: number; w: number }>;
  assert.equal(els.length, 3);
  assert.equal(els[0].x, 0);
  assert.equal(els[0].w, 100);
  assert.equal(els[1].x, 100);
  assert.equal(els[2].x, 200);
});

test('extraHandlers: ctx passed through', () => {
  const captured: unknown[] = [];
  const probe: Handler = (_n, _b, ctx, _els) => {
    captured.push(ctx);
  };
  compileFromSource('probe x=0 y=0', { extraHandlers: { probe }, ctx: { tenant: 'acme' } });
  assert.deepEqual(captured, [{ tenant: 'acme' }]);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
