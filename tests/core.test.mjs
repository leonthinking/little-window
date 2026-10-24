import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, screenBounds, centeredBounds } from '../core.js';

test('queries preserve Unicode and search syntax', () => {
  for (const q of ['中文搜索', 'a+b & c?', 'site:example.com test', 'hello world', '<img src=x onerror=alert(1)>', '1.2']) {
    assert.deepEqual(resolveInput(`  ${q}  `), {kind: 'search', text: q});
  }
});
test('web addresses normalize without a hard-coded search engine', () => {
  assert.deepEqual(resolveInput('example.com/docs?q=a#b'), {kind:'url',url:'https://example.com/docs?q=a#b'});
  assert.deepEqual(resolveInput('localhost:3000/a'), {kind:'url',url:'http://localhost:3000/a'});
  assert.equal(resolveInput('127.0.0.1:8080').url, 'http://127.0.0.1:8080/');
  assert.equal(resolveInput('[::1]:8080').url, 'http://[::1]:8080/');
  assert.equal(resolveInput('例子.中国').url, 'https://xn--fsqu00a.xn--fiqs8s/');
  assert.equal(resolveInput('https://example.com/a b').url, 'https://example.com/a%20b');
});
test('unsupported navigation and credential URLs fail safely', () => {
  for (const s of ['', ' ', 'x'.repeat(8193), 'javascript:alert(1)', 'DATA:text/html,hello', 'file:///etc/passwd', 'chrome://settings', 'chrome-extension://id/x', 'ftp://example.com', 'https://', 'http://x:99999', 'https://user:pass@example.com']) {
    assert.throws(() => resolveInput(s), undefined, s);
  }
});
test('display geometry accepts negative monitors and rejects malformed bounds', () => {
  const left = {left:-1920,top:0,width:1920,height:1080};
  assert.deepEqual(screenBounds(left), left);
  for(const v of [null,{}, {...left,width:NaN}, {...left,width:99}, {...left,height:Infinity}, {...left,left:1e8}]) assert.equal(screenBounds(v),null);
  const target = centeredBounds(left,{width:664,height:250},.32);
  assert.equal(target.left,-1292);
  assert.equal(target.top,266);
  assert.deepEqual(centeredBounds({left:0,top:0,width:400,height:300},{width:1000,height:760}),{left:0,top:0,width:400,height:300});
});
