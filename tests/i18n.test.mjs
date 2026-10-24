import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = name => fs.readFile(new URL(name, root), 'utf8');
const locales = Object.fromEntries(await Promise.all(['en', 'zh_CN'].map(async name => [name, JSON.parse(await read(`_locales/${name}/messages.json`))])));

test('English and Chinese catalogs have matching, nonempty messages and substitutions', () => {
  assert.deepEqual(Object.keys(locales.en).sort(), Object.keys(locales.zh_CN).sort());
  for (const key of Object.keys(locales.en)) {
    for (const catalog of Object.values(locales)) assert.ok(catalog[key].message.trim(), key);
    const substitutions = locale => (locales[locale][key].message.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(substitutions('en'), substitutions('zh_CN'), key);
  }
});

test('Every static UI, manifest and backend error key has translations', async () => {
  const manifest = await read('manifest.json');
  for (const [, key] of manifest.matchAll(/__MSG_(\w+)__/g)) assert.ok(locales.en[key], key);
  for (const file of ['search.html', 'setup.html', 'search.js', 'setup.js', 'background.js', 'core.js']) {
    const source = await read(file);
    const keys = [...source.matchAll(/data-i18n(?:-(?:aria|title|placeholder))?="(\w+)"/g), ...source.matchAll(/\bt\("(\w+)"/g), ...source.matchAll(/new Error\("(error_\w+)"\)/g)].map(match => match[1]);
    for (const key of keys) assert.ok(locales.en[key], `${file}: ${key}`);
  }
});

test('Language preference follows Chinese variants and falls back to English', async () => {
  const { resolveLanguage } = await import('../i18n.js');
  for (const locale of ['zh', 'zh-CN', 'zh-TW', 'zh_HK']) assert.equal(resolveLanguage('auto', locale), 'zh_CN');
  for (const locale of ['en-US', 'fr', 'de-DE']) assert.equal(resolveLanguage('auto', locale), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('zh_CN', 'en-US'), 'zh_CN');
});

test('Manifest grants no history/site access and assigns no default shortcuts', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.deepEqual(manifest.permissions.sort(), ['search', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.incognito, 'not_allowed');
  assert.equal(manifest.default_locale, 'en');
  for (const command of Object.values(manifest.commands)) assert.equal(command.suggested_key, undefined);
});
