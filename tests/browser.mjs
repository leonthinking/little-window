import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.env.TEST_OUTPUT_DIR || 'test-results');
await fs.mkdir(output, {recursive: true});
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'little-window-test-'));
const passed = [];
const errors = [];
let context, setup, worker, id;
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><title>Little Window test page</title><h1>Real browsing window</h1><p id="state"></p><script>document.querySelector("#state").textContent=localStorage.getItem("proof")||"";</script>');
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0, '127.0.0.1', resolve); });
const localUrl = `http://127.0.0.1:${server.address().port}/`;
const launchOptions = {
  headless: true, viewport: null,
  ...(process.env.CHROME_EXECUTABLE_PATH ? {executablePath:process.env.CHROME_EXECUTABLE_PATH} : {channel:'chromium'}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-first-run', '--no-default-browser-check'],
};
const check = async (name, run) => { await run(); passed.push(name); console.log(`PASS ${name}`); };
const poll = async (fn, predicate, message) => {
  const end = Date.now() + 10000;
  let actual;
  do { actual = await fn(); if(predicate(actual)) return actual; await new Promise(r=>setTimeout(r,50)); } while (Date.now()<end);
  assert.fail(`${message}: ${JSON.stringify(actual)}`);
};
async function start() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  id = new URL(worker.url()).host;
  await worker.evaluate(()=>{
    globalThis.__windowUpdateFailures=[];
    const original=chrome.windows.update.bind(chrome.windows);
    chrome.windows.update=async(...args)=>{
      try{return await original(...args);}
      catch(error){globalThis.__windowUpdateFailures.push({args,error:error.message});throw error;}
    };
  });
  setup = await context.newPage();
  await setup.goto(`chrome-extension://${id}/setup.html`);
  await setup.locator('#try').waitFor();
  await setup.evaluate(() => chrome.runtime.sendMessage({type:'set-language',language:'en'}));
}
async function request(page, message) { return page.evaluate(m => chrome.runtime.sendMessage(m), message); }
async function state() { return request(setup,{type:'get-state'}); }
async function launch() {
  const response = await request(setup,{type:'open-launcher'});
  assert.equal(response.ok,true,JSON.stringify(response));
  const page = await poll(async()=>context.pages().find(p=>p.url()===`chrome-extension://${id}/search.html`),Boolean,'launcher missing');
  await page.locator('#query').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='query');
  await page.waitForFunction(()=>document.documentElement.lang.startsWith('en'));
  const ready=await request(page,{type:'get-state'});
  assert.equal(ready.ok,true,`Launcher is not authorized: ${JSON.stringify(ready)}`);
  return page;
}
async function bounds(page) {
  return page.evaluate(async()=>{
    const tab=await chrome.tabs.getCurrent();
    const {id,left,top,width,height,state,type}=await chrome.windows.get(tab.windowId);
    return {id,left,top,width,height,state,type};
  });
}
const geometry = ({left,top,width,height})=>({left,top,width,height});
async function close(page) { const closed=page.waitForEvent('close'); await page.close(); await closed; }
async function browse(page,input) { await page.locator('#query').fill(input); await page.locator('#submit').click(); }

try {
  await start();
  await check('MV3 loads with minimal permissions and no default global key', async()=>{
    const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
    assert.deepEqual(manifest.permissions.sort(),['search','storage']);
    assert.equal(manifest.incognito,'not_allowed');
    const commands=await worker.evaluate(()=>chrome.commands.getAll());
    assert.ok(commands.length);
    assert.ok(commands.every(x=>!x.shortcut));
  });
  await check('Eight cold simultaneous requests create one launcher',async()=>{
    const replies=await setup.evaluate(()=>Promise.all(Array.from({length:8},()=>chrome.runtime.sendMessage({type:'open-launcher'}))));
    assert.ok(replies.every(reply=>reply.ok));
    await poll(async()=>context.pages().filter(page=>page.url().endsWith('/search.html')).length,count=>count===1,'cold launcher duplication');
  });
  let search=await launch();
  await check('Independent launcher, focused input, empty history and EN/ZH live switching',async()=>{
    assert.equal((await bounds(search)).type,'popup');
    assert.deepEqual((await state()).history,[]);
    await request(setup,{type:'set-language',language:'zh_CN'});
    await search.waitForFunction(()=>document.documentElement.lang.startsWith('zh'));
    assert.match(await search.locator('#query').getAttribute('placeholder'),/搜索/);
    await search.screenshot({path:path.join(output,'launcher-zh.png')});
    await request(setup,{type:'set-language',language:'en'});
    await search.waitForFunction(()=>document.documentElement.lang.startsWith('en'));
    assert.match(await search.locator('#query').getAttribute('placeholder'),/search/i);
    await setup.screenshot({path:path.join(output,'setup-en.png'),fullPage:true});
  });
  await check('Eight concurrent launch requests reuse one window',async()=>{
    await setup.evaluate(()=>Promise.all(Array.from({length:8},()=>chrome.runtime.sendMessage({type:'open-launcher'}))));
    assert.equal(context.pages().filter(p=>p.url().endsWith('/search.html')).length,1);
  });
  await check('Unauthorized page and malformed messages cannot navigate or change settings',async()=>{
    assert.equal((await request(setup,{type:'browse',input:localUrl})).ok,false);
    assert.equal((await request(setup,{type:'set-language',language:'<script>'})).ok,false);
    assert.equal((await request(search,null)).ok,false);
    const normal=await context.newPage();
    await normal.goto(`chrome-extension://${id}/search.html`);
    assert.equal((await request(normal,{type:'browse',input:localUrl})).ok,false);
    await normal.close();
  });
  await check('Empty/unsafe input, translated error, IME Enter and Escape do not navigate',async()=>{
    await search.locator('#query').press('Enter');
    await search.locator('#error').filter({hasText:/./}).waitFor();
    assert.match(await search.locator('#error').textContent(),/[A-Za-z]/);
    await search.locator('#query').fill('javascript:alert(1)');
    await search.locator('#query').press('Enter');
    assert.equal((await state()).history.length,0);
    await search.locator('#query').fill('中文选词');
    await search.locator('#query').dispatchEvent('compositionstart');
    await search.locator('#query').press('Enter');
    await search.locator('#query').press('Escape');
    assert.equal(search.isClosed(),false);
    assert.ok(search.url().endsWith('/search.html'));
    await search.locator('#query').dispatchEvent('compositionend');
  });
  await check('Launcher move/resize survives close/reopen',async()=>{
    const before=await bounds(search);
    await worker.evaluate(async({id})=>chrome.windows.update(id,{left:75,top:80,width:700,height:510}),before);
    const actual=geometry(await bounds(search));
    await poll(()=>worker.evaluate(()=>chrome.storage.local.get('launcherBounds')),v=>isDeepStrictEqual(v.launcherBounds,actual),'launcher geometry not saved');
    const closed=search.waitForEvent('close');
    await search.locator('#close').click(); await closed;
    search=await launch();
    assert.deepEqual(geometry(await bounds(search)),actual);
  });
  await check('Search failure leaves editable launcher, unchanged history and bounds',async()=>{
    const before=geometry(await bounds(search));
    await worker.evaluate(()=>{globalThis.savedSearch=chrome.search.query;chrome.search.query=async()=>{throw new Error('test failure');};});
    try {
      await browse(search,'failure recovery');
      await search.locator('#error').filter({hasText:/./}).waitFor();
      assert.equal(await search.locator('#submit').isEnabled(),true);
      assert.equal(await search.locator('#query').getAttribute('readonly'),null);
      assert.equal((await state()).history.length,0);
      assert.deepEqual(geometry(await bounds(search)),before);
    } finally { await worker.evaluate(()=>{chrome.search.query=globalThis.savedSearch;}); }
  });
  let browserWindow;
  await check('URL opens in the same popup with shared website storage; history records submission',async()=>{
    const original=await bounds(search);
    const seed=await context.newPage();await seed.goto(localUrl);
    await seed.evaluate(()=>localStorage.setItem('proof','shared-profile'));
    await browse(search,localUrl); await search.waitForURL(localUrl);
    assert.equal(await search.locator('#state').textContent(),'shared-profile');
    browserWindow=await worker.evaluate(id=>chrome.windows.get(id),original.id);
    assert.equal(browserWindow.type,'popup');
    await poll(state,s=>s.history?.length===1,'history not recorded');
    assert.equal((await state()).history[0].input,localUrl);
    await seed.close();
  });
  await check('Browser size is saved separately and ordinary Chrome windows cannot overwrite it',async()=>{
    await worker.evaluate(id=>chrome.windows.update(id,{left:110,top:90,width:600,height:400}),browserWindow.id);
    const expected=geometry(await worker.evaluate(id=>chrome.windows.get(id),browserWindow.id));
    await poll(()=>worker.evaluate(()=>chrome.storage.local.get('browserBounds')),s=>isDeepStrictEqual(s.browserBounds,expected),'browser bounds not saved');
    const ordinary=await bounds(setup);
    await worker.evaluate(id=>chrome.windows.update(id,{left:15,top:20,width:930,height:700}),ordinary.id);
    const fresh=await launch();
    assert.equal(search.isClosed(),false);
    const freshBounds=await bounds(fresh);
    assert.equal(freshBounds.width,700);
    await browse(fresh,localUrl+'second');await fresh.waitForURL(localUrl+'second');
    assert.deepEqual(geometry(await worker.evaluate(id=>chrome.windows.get(id),freshBounds.id)),expected);
    await fresh.close();
  });
  await check('Back to launcher permits re-navigation and preserves another launcher registration',async()=>{
    const fresh=await launch();
    await search.goBack();await search.waitForURL(`chrome-extension://${id}/search.html`);
    await browse(search,localUrl+'back');await search.waitForURL(localUrl+'back');
    assert.equal(fresh.isClosed(),false);
    await request(setup,{type:'open-launcher'});
    assert.equal(context.pages().filter(p=>p.url().endsWith('/search.html')).length,1);
    await fresh.close();await search.close();
  });
  let captured;
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,async route=>{
    if(route.request().isNavigationRequest()) captured=route.request().url();
    await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<title>Search intercepted</title><h1>Default search received</h1>'});
  });
  const query='中文 Arc + Chrome & window?';
  await check('Configured search engine receives exact Unicode/punctuation query',async()=>{
    search=await launch();await browse(search,query);
    await search.locator('h1').filter({hasText:'Default search received'}).waitFor();
    assert.equal(new URL(captured).searchParams.get('q'),query);
    await search.close();
  });
  await check('History caps at five, deduplicates and moves repeated query to front',async()=>{
    await request(setup,{type:'history-clear'});
    for(let i=0;i<7;i++){
      const p=await launch();await browse(p,localUrl+`item${i}`);await p.waitForURL(localUrl+`item${i}`);await p.close();
    }
    await poll(state,s=>s.history?.[0]?.input===localUrl+'item6','latest history missing');
    const history=(await state()).history;
    assert.equal(history.length,5);
    assert.deepEqual(history.map(x=>x.input),[6,5,4,3,2].map(i=>localUrl+`item${i}`));
    const p=await launch();await browse(p,localUrl+'item3');await p.waitForURL(localUrl+'item3');await p.close();
    await poll(state,s=>s.history?.[0]?.input===localUrl+'item3','duplicate not promoted');
    assert.equal((await state()).history.length,5);
  });
  await check('History UI displays five safe rows, supports replay, delete, clear and dark mode',async()=>{
    search=await launch();
    await search.locator('[data-history-id]').first().waitFor();
    await search.screenshot({path:path.join(output,'launcher-en.png')});
    await search.emulateMedia({colorScheme:'dark'});
    await search.screenshot({path:path.join(output,'launcher-dark.png')});
    await search.emulateMedia({colorScheme:'light'});
    // Use an entry's visible text to exercise the actual replay button.
    await search.locator('.history-open').filter({hasText:localUrl+'item3'}).click();
    await search.waitForURL(localUrl+'item3');await search.close();
    search=await launch();
    await search.getByRole('button',{name:/remove|delete/i}).first().click();
    await poll(state,s=>s.history?.length===4,'delete failed');
    await search.getByRole('button',{name:/clear/i}).click();
    await poll(state,s=>s.history?.length===0,'clear failed');
    const malicious='<img src=x onerror=alert(1)>';
    await browse(search,malicious);await search.locator('h1').waitFor();await search.close();
    search=await launch();
    assert.equal(await search.locator('img[src="x"]').count(),0);
    assert.ok((await search.locator('body').innerText()).includes(malicious));
    await search.close();
  });
  await check('Session state lost then restored page re-registers and stays usable',async()=>{
    search=await launch();
    await worker.evaluate(()=>chrome.storage.session.clear());
    await search.reload();await search.locator('#query').waitFor();
    await request(search,{type:'launcher-ready',screen:{left:0,top:0,width:1280,height:720}});
    await request(setup,{type:'open-launcher'});
    assert.equal(context.pages().filter(p=>p.url().endsWith('/search.html')).length,1);
    await search.close();
  });
  await check('Real service worker stop/resume preserves owned window tracking',async()=>{
    search=await launch();
    const original=await bounds(search);
    const swUrl=worker.url();
    const devtools=await context.newCDPSession(setup);
    let status;
    devtools.on('ServiceWorker.workerVersionUpdated',({versions})=>{
      for(const version of versions) if(version.scriptURL===swUrl) status=version.runningStatus;
    });
    await devtools.send('ServiceWorker.enable');
    await worker.evaluate(()=>{globalThis.__suspendProof='before';});
    await devtools.send('ServiceWorker.stopAllWorkers');
    await poll(async()=>status,value=>value==='stopped','service worker did not stop');
    assert.equal((await request(setup,{type:'get-state'})).ok,true);
    await poll(async()=>status,value=>value==='running','service worker did not resume');
    assert.equal(await worker.evaluate(()=>globalThis.__suspendProof),undefined);
    await request(setup,{type:'open-launcher'});
    assert.equal(context.pages().filter(p=>p.url().endsWith('/search.html')).length,1);
    await worker.evaluate(id=>chrome.windows.update(id,{left:30,top:40,width:680,height:490}),original.id);
    const expected=geometry(await bounds(search));
    await poll(()=>worker.evaluate(()=>chrome.storage.local.get('launcherBounds')),s=>isDeepStrictEqual(s.launcherBounds,expected),'resumed worker did not track geometry');
    await devtools.detach();await search.close();
  });
  await check('Escape dismisses expanded language menu first, and closes a collapsed focused selector',async()=>{
    search=await launch();
    await search.locator('#language').click();
    await search.locator('#language').press('Escape');
    await search.waitForFunction(()=>!document.querySelector('#language').matches(':open'));
    assert.equal(search.isClosed(),false);
    await search.locator('#language').focus();
    const closed=search.waitForEvent('close');
    await search.locator('#language').press('Escape');
    await closed;
    search=await launch();
    await search.locator('#language').focus();
    const collapsedClosed=search.waitForEvent('close');
    await search.locator('#language').press('Escape');
    await collapsedClosed;
  });
  await check('Offscreen saved bounds recover into current available screen',async()=>{
    await worker.evaluate(()=>chrome.storage.local.set({launcherBounds:{left:-9000,top:-9000,width:9000,height:8000}}));
    search=await launch();
    const area=await search.evaluate(()=>({left:screen.availLeft??0,top:screen.availTop??0,width:screen.availWidth,height:screen.availHeight}));
    await poll(()=>bounds(search),b=>b.left>=area.left&&b.top>=area.top&&b.width<=area.width&&b.height<=area.height,'bounds remain offscreen');
    const closed=search.waitForEvent('close');await search.locator('#query').press('Escape');await closed;
  });
  await check('Browser restart persists history, language and geometry',async()=>{
    await request(setup,{type:'set-language',language:'zh_CN'});
    const saved=await worker.evaluate(()=>chrome.storage.local.get(null));
    await context.close();context=null;
    // Do not use start(), which intentionally selects English for other tests.
    context=await chromium.launchPersistentContext(profile,launchOptions);
    worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const actual=await worker.evaluate(()=>chrome.storage.local.get(null));
    for(const key of ['history','language','launcherBounds','browserBounds']) assert.deepEqual(actual[key],saved[key]);
    setup=await context.newPage();await setup.goto(`chrome-extension://${id}/setup.html`);
    await setup.waitForFunction(()=>document.documentElement.lang.startsWith('zh'));
    await setup.screenshot({path:path.join(output,'setup-zh.png'),fullPage:true});
  });
  // Synthetic, non-personal lookups for documentation images only.
  await request(setup,{type:'set-language',language:'en'});
  await worker.evaluate(()=>chrome.storage.local.set({
    launcherBounds:{left:20,top:30,width:664,height:470},
    history:[
      {input:'https://developer.chrome.com/docs/extensions',kind:'url'},
      {input:'Little Arc keyboard shortcuts',kind:'search'},
      {input:'https://github.com/leonthinking/little-window',kind:'url'},
      {input:'周末有什么值得看的展览',kind:'search'},
      {input:'https://example.com/',kind:'url'},
    ].map((entry,i)=>({...entry,id:`demo-${i}`,updatedAt:1000-i}))
  }));
  search=await launch();
  await search.screenshot({path:path.join(output,'launcher-en.png')});
  await search.emulateMedia({colorScheme:'dark'});
  await search.screenshot({path:path.join(output,'launcher-dark.png')});
  await search.emulateMedia({colorScheme:'light'});
  await request(setup,{type:'set-language',language:'zh_CN'});
  await search.waitForFunction(()=>document.documentElement.lang.startsWith('zh'));
  await search.screenshot({path:path.join(output,'launcher-zh.png')});
  assert.deepEqual(errors,[]);
  console.log(`${passed.length} browser scenarios passed.`);
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({browser:context.browser()?.version(),passed,errors},null,2));
} catch(error) {
  const diagnostics=await worker?.evaluate(async()=>({
    windows:await chrome.windows.getAll({populate:true}),
    session:await chrome.storage.session.get(null),
    updateFailures:globalThis.__windowUpdateFailures,
  })).catch(()=>null);
  console.error('Browser diagnostic',JSON.stringify({browser:context?.browser()?.version(),diagnostics}));
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({passed,errors,failure:error.stack,diagnostics},null,2));
  for(const [i,page] of (context?.pages()||[]).entries()) await page.screenshot({path:path.join(output,`failure-${i}.png`)}).catch(()=>{});
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true});
}
