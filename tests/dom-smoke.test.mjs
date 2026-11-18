import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('index.html'), app = read('js/app.js'), css = read('styles.css');
const modules = fs.readdirSync(path.join(ROOT, 'js')).filter((file) => /\.(mjs|js)$/.test(file)).map((file) => 'js/' + file);
test('HTML loads only local existing assets, with no inline scripts or event handlers', () => {
  assert.ok(html.includes('href="styles.css?v=studio-c49dfe94a109"')); assert.ok(html.includes('src="js/app.js?v=studio-c49dfe94a109"'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (match[1].startsWith('#')) continue;
    assert.ok(!/^(?:https?:)?\/\//.test(match[1]));
    assert.ok(fs.existsSync(path.join(ROOT, match[1].split('?')[0])), 'Missing local asset');
  }
});
test('every static app DOM reference exists and dynamic SVG IDs have explicit producers', () => {
  const ids = [...app.matchAll(/document\.getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(ids.length >= 60);
  for (const id of ids) {
    if (id === 'fifo-path') { assert.ok(app.includes("id: 'fifo-path'")); continue; }
    assert.ok(html.includes('id="' + id + '"'), 'Missing DOM element ' + id);
  }
  assert.ok(app.includes("playhead.id = 'timeline-playhead'"));
  assert.ok(app.includes("id: 'route-commuter'"));
});
test('HTML IDs are unique and all explicit form labels point to controls', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
});
test('every browser ES module parses and every relative import exists', () => {
  for (const file of modules) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' }));
    for (const match of read(file).matchAll(/^import\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(match[1].startsWith('./') || match[1].startsWith('../'));
      assert.ok(fs.existsSync(path.resolve(ROOT, path.dirname(file), match[1].split('?')[0])));
    }
  }
});
test('zero external requests are enforced by local assets and a disconnected CSP', () => {
  assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("script-src 'self'"));
  assert.ok(html.includes("worker-src 'self'")); assert.ok(html.includes("object-src 'none'"));
  assert.ok(!/@import|@font-face|https?:\/\//i.test(css));
  for (const file of modules) {
    const source = read(file);
    assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(source));
    assert.ok(!/\b(?:from|import)\s*['"]https?:/.test(source));
  }
});
test('production modules build all dynamic content with safe DOM nodes', () => {
  for (const file of modules) assert.ok(!/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b/.test(read(file)), 'Unsafe DOM or code sink in ' + file);
  assert.ok(app.includes('element.textContent = String(text)'));
  assert.ok(app.includes('replaceChildren'));
});
test('CSS includes mobile layout, reduced motion, explicit hidden semantics, and one-page print rules', () => {
  assert.ok(css.includes('@media (max-width: 980px)'));
  assert.ok(css.includes('@media (max-width: 600px)'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('[hidden] { display: none !important; }'));
  assert.ok(css.includes('@media print')); assert.ok(css.includes('size: letter portrait'));
  assert.ok(!/html\s*\{[^}]*scroll-behavior:\s*smooth/.test(css));
});
test('Capybara is an inline SVG with a tangerine, backpack, click reaction, and reduced-motion handling', () => {
  const start = html.indexOf('id="capybara-buddy"'), end = html.indexOf('</button>', start), buddy = html.slice(start, end);
  assert.ok(buddy.includes('<svg')); assert.ok(buddy.includes('#f38a42')); assert.ok(buddy.includes('<rect'));
  assert.ok(app.includes("ui.capy.addEventListener('click'")); assert.ok(app.includes("location.hash === '#capybara-buddy'"));
  assert.ok(app.includes('!reducedMotion.matches')); assert.ok(css.includes('.capybara-buddy.is-happy'));
});
test('replay uses the same computed clock for the marker and all timeline playheads', () => {
  assert.ok(app.includes('replayPosition('));
  assert.ok(app.includes('state.marker.dataset.clock = position.clockMin'));
  assert.ok(app.includes('head.dataset.clock = position.clockMin'));
  assert.ok(app.includes("cancelAnimationFrame(state.frame)"));
  assert.ok(app.includes("document.addEventListener('visibilitychange'"));
});
test('worker failures and stale responses are handled with a labeled local fallback', () => {
  assert.ok(app.includes("new Worker(new URL('./solver-worker.mjs?v=studio-c49dfe94a109'"));
  assert.ok(app.includes('if (message.id !== state.requestId) return'));
  assert.ok(app.includes("state.execution = 'Main thread fallback'"));
  assert.ok(app.includes('state.worker?.terminate()'));
  assert.ok(app.includes('setTimeout(fallbackWorker, 15000)'));
});
function luminance(hex) {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
for (const [theme, pattern] of [['daylight', /:root\s*\{([^}]+)\}/], ['dark', /:root\[data-theme="dark"\]\s*\{([^}]+)\}/]]) {
  test('all ' + theme + ' text palette pairs meet WCAG AA 4.5 to 1', () => {
    const variables = Object.fromEntries([...pattern.exec(css)[1].matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/gi)].map((match) => [match[1], match[2]]));
    for (const [fg, bg] of [['ink', 'bg'], ['ink', 'paper'], ['ink', 'map'], ['muted', 'bg'], ['muted', 'paper'], ['muted', 'map'], ['muted', 'green-soft'], ['muted', 'orange-soft'], ['green', 'green-soft'], ['red', 'red-soft'], ['paper', 'green'], ['paper', 'ink']]) assert.ok(contrast(variables[fg], variables[bg]) >= 4.5, theme + ' ' + fg + '/' + bg + ' contrast is ' + contrast(variables[fg], variables[bg]));
    assert.ok(contrast('#203c32', variables.orange) >= 4.5);
  });
}
test('shipped text and SVG files contain no typographic dashes, smart quotes, private paths, or personal email domains', () => {
  const forbidden = new RegExp(String.fromCharCode(0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d).split('').join('|'));
  const homePrefix = new RegExp(String.fromCharCode(47, 85, 115, 101, 114, 115, 47));
  const personalMail = new RegExp(['gmail', 'icloud'].map((domain) => domain + '\\.com').join('|'), 'i');
  const extensions = new Set(['.html', '.css', '.js', '.mjs', '.md', '.json', '.txt', '.svg']);
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.DS_Store'].includes(item.name)) continue;
      const full = path.join(directory, item.name);
      if (item.isDirectory()) { walk(full); continue; }
      if (!extensions.has(path.extname(full)) && item.name !== 'LICENSE') continue;
      const text = fs.readFileSync(full, 'utf8');
      assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'Source must end with one newline in ' + full);
      assert.equal(forbidden.test(text), false, 'Typographic punctuation in ' + full);
      assert.equal(homePrefix.test(text), false, 'Private path in ' + full);
      assert.equal(personalMail.test(text), false, 'Personal email in ' + full);
    }
  }
  // Prove the scanner detects each forbidden code point before relying on a clean result.
  for (const code of [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d]) assert.equal(forbidden.test(String.fromCharCode(code)), true);
  walk(ROOT);
});
