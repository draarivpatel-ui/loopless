import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('HTML references only local existing assets and has zero inline scripts or event handlers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('href="styles.css"'));
  assert.ok(html.includes('src="js/app.js"'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'No inline <script> blocks');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'No inline on* attributes');
  assert.ok(fs.existsSync(path.join(ROOT, 'styles.css')));
  assert.ok(fs.existsSync(path.join(ROOT, 'js/app.js')));
});

test('all DOM IDs referenced by js/app.js exist in index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const ids = [...appJs.matchAll(/document\.getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20);
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `Missing DOM element id="${id}" in index.html`);
  }
});

test('all JS modules parse cleanly as ES modules without syntax errors', () => {
  const jsFiles = ['js/planner.mjs', 'js/scenarios.mjs', 'js/benchmark.mjs', 'js/app.js'];
  for (const rel of jsFiles) {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
    });
  }
});

test('CSS contains responsive, reduced-motion, and print media rules', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.ok(css.includes('@media (max-width: 980px)'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('@media print'));
});

test('shipped text files contain no em-dashes, en-dashes, private paths, or restricted terms', () => {
  const homePrefixRe = new RegExp(String.fromCharCode(47, 85, 115, 101, 114, 115, 47));
  const mailRe = new RegExp(['gmail', 'icloud'].map((d) => `${d}\\.com`).join('|'), 'i');
  const walk = (dir) => {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };
  const textExts = new Set(['.html', '.css', '.js', '.mjs', '.md', '.json', '.txt']);
  for (const file of walk(ROOT)) {
    const ext = path.extname(file).toLowerCase();
    if (!textExts.has(ext) && path.basename(file) !== 'LICENSE') continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('\u2014'), false, `Em-dash found in ${file}`);
    assert.equal(text.includes('\u2013'), false, `En-dash found in ${file}`);
    assert.equal(homePrefixRe.test(text), false, `Local home directory path in ${file}`);
    assert.equal(mailRe.test(text), false, `Personal email domain in ${file}`);
  }
});
