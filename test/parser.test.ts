// Run: node --experimental-strip-types --no-warnings test/parser.test.ts
import assert from 'node:assert/strict';
import { parseDsl } from '../src/dsl/parser.ts';
import { DslParseError } from '../src/dsl/types.ts';

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error('    ', e instanceof Error ? e.message : e);
    fail++;
  }
}

console.log('\n== DSL Parser Tests ==\n');

test('empty input → empty array', () => {
  assert.deepEqual(parseDsl(''), []);
  assert.deepEqual(parseDsl('   \n  \t '), []);
});

test('single node, no attrs, no children', () => {
  const nodes = parseDsl('dashboard');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'dashboard');
  assert.deepEqual(nodes[0].attrs, {});
  assert.equal(nodes[0].children, undefined);
});

test('attrs: string, number, bool, color, ident', () => {
  const [n] = parseDsl('card title="Hello" w=240 active=true color=#3b82f6 size=big');
  assert.equal(n.type, 'card');
  assert.equal(n.attrs.title, 'Hello');
  assert.equal(n.attrs.w, 240);
  assert.equal(n.attrs.active, true);
  assert.equal(n.attrs.color, '#3b82f6');
  assert.equal(n.attrs.size, 'big');
});

test('negative and decimal numbers', () => {
  const [n] = parseDsl('box x=-12 y=3.5');
  assert.equal(n.attrs.x, -12);
  assert.equal(n.attrs.y, 3.5);
});

test('array values', () => {
  const [n] = parseDsl('topbar crumbs=["Kunde XY", "Firewall"]');
  assert.deepEqual(n.attrs.crumbs, ['Kunde XY', 'Firewall']);
});

test('children with braces', () => {
  const [root] = parseDsl(`
    dashboard {
      topbar
      row gap=12 {
        card title="A"
        card title="B"
      }
    }
  `);
  assert.equal(root.type, 'dashboard');
  assert.equal(root.children?.length, 2);
  assert.equal(root.children?.[0].type, 'topbar');
  assert.equal(root.children?.[1].type, 'row');
  assert.equal(root.children?.[1].attrs.gap, 12);
  assert.equal(root.children?.[1].children?.length, 2);
  assert.equal(root.children?.[1].children?.[0].attrs.title, 'A');
});

test('text body via bare string after attrs', () => {
  const [n] = parseDsl('txt size=14 "Hallo Welt"');
  assert.equal(n.type, 'txt');
  assert.equal(n.attrs.size, 14);
  assert.equal(n.body, 'Hallo Welt');
});

test('escapes in strings', () => {
  const [n] = parseDsl('txt "line1\\nline2 with \\"quote\\""');
  assert.equal(n.body, 'line1\nline2 with "quote"');
});

test('line + block comments ignored', () => {
  const nodes = parseDsl(`
    // comment
    card title="A" /* inline */ w=100
    /* block
       comment */
    card title="B"
  `);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].attrs.title, 'A');
  assert.equal(nodes[0].attrs.w, 100);
  assert.equal(nodes[1].attrs.title, 'B');
});

test('multiple top-level nodes', () => {
  const nodes = parseDsl('a\nb\nc');
  assert.equal(nodes.length, 3);
  assert.deepEqual(
    nodes.map((n) => n.type),
    ['a', 'b', 'c']
  );
});

test('deep nesting', () => {
  const [root] = parseDsl('a { b { c { d } } }');
  assert.equal(root.type, 'a');
  assert.equal(root.children?.[0].type, 'b');
  assert.equal(root.children?.[0].children?.[0].type, 'c');
  assert.equal(root.children?.[0].children?.[0].children?.[0].type, 'd');
});

test('error: unterminated string', () => {
  assert.throws(() => parseDsl('card title="oops'), DslParseError);
});

test('error: unterminated block', () => {
  assert.throws(() => parseDsl('card { open'), DslParseError);
});

test('error: unexpected char', () => {
  assert.throws(() => parseDsl('card @bad'), DslParseError);
});

test('token-efficiency: realistic roadmap scene', () => {
  const dsl = `
    dashboard {
      topbar crumbs=["Kunde XY"]
      row gap=12 {
        roadmapCard title="Persistence" color=#3b82f6 done=1 total=4
        roadmapCard title="Claude-Integration" color=#a855f7 done=1 total=8
        roadmapCard title="UX & Features" color=#f59e0b done=3 total=6
        roadmapCard title="Polish & Tooling" color=#10b981 done=3 total=5
      }
    }
  `;
  const nodes = parseDsl(dsl);
  assert.equal(nodes.length, 1);
  const cards = nodes[0].children?.[1].children ?? [];
  assert.equal(cards.length, 4);
  assert.equal(cards[0].type, 'roadmapCard');
  assert.equal(cards[0].attrs.title, 'Persistence');
  assert.equal(cards[0].attrs.done, 1);
  assert.equal(cards[0].attrs.total, 4);
});

test('normalize: en-dash / em-dash outside strings → ASCII hyphen', () => {
  const dsl = 'col x=0 y=0 w=1200 h=700 pad=16 { txt size=18 "Dashboard \u2013 Overview" }';
  const nodes = parseDsl(dsl);
  assert.equal(nodes.length, 1);
  const txt = nodes[0].children?.[0];
  assert.equal(txt?.type, 'txt');
  assert.equal(txt?.body, 'Dashboard - Overview');
});

test('normalize: smart quotes → straight quotes', () => {
  const dsl = 'txt \u201cHello\u201d';
  const nodes = parseDsl(dsl);
  assert.equal(nodes[0].body, 'Hello');
});

test('normalize: non-breaking space treated as whitespace', () => {
  const dsl = 'rect\u00a0x=10\u00a0y=20\u00a0w=30\u00a0h=40';
  const nodes = parseDsl(dsl);
  assert.deepEqual(nodes[0].attrs, { x: 10, y: 20, w: 30, h: 40 });
});

test('normalize: strip markdown code fence with language tag', () => {
  const dsl = '```dsl\ncol x=0 y=0 w=1200 h=700 { txt "Hi" }\n```';
  const nodes = parseDsl(dsl);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'col');
  assert.equal(nodes[0].children?.[0].body, 'Hi');
});

test('normalize: strip bare markdown code fence', () => {
  const dsl = '```\ndashboard\n```';
  const nodes = parseDsl(dsl);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'dashboard');
});

test('number: drop percent-sized attr, keep pixel attr', () => {
  // `w=80%` at 100px in a 1200px parent is catastrophic (renders at 8% of
  // intended width); omission at least lets the row/col auto-flex.
  const [n] = parseDsl('bar w=80% h=12');
  assert.equal(n.attrs.w, undefined);
  assert.equal(n.attrs.h, 12);
});

test('number: drop all percent attrs, keep other attrs + body', () => {
  const [n] = parseDsl('rect w=100% h=50% bg=#fff "label"');
  assert.equal(n.attrs.w, undefined);
  assert.equal(n.attrs.h, undefined);
  assert.equal(n.attrs.bg, '#fff');
  assert.equal(n.body, 'label');
});

test('number: tolerate trailing "px" unit suffix', () => {
  const [n] = parseDsl('rect w=320px h=48px');
  assert.equal(n.attrs.w, 320);
  assert.equal(n.attrs.h, 48);
});

test('body: string before attrs (Haiku style)', () => {
  const [n] = parseDsl('txt "Title" size=20 color=#fff');
  assert.equal(n.type, 'txt');
  assert.equal(n.body, 'Title');
  assert.equal(n.attrs.size, 20);
  assert.equal(n.attrs.color, '#fff');
});

test('body: interleaved between attrs', () => {
  const [n] = parseDsl('txt h=30 "Kanban Board" size=18 color=#e4e7ec');
  assert.equal(n.body, 'Kanban Board');
  assert.equal(n.attrs.h, 30);
  assert.equal(n.attrs.size, 18);
  assert.equal(n.attrs.color, '#e4e7ec');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
