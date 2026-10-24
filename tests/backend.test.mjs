import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, LAUNCHER_SIZE } from '../core.js';
import { addHistory, cleanHistory, removeHistory } from '../history.js';
import { normalBounds, restoredBounds } from '../geometry.js';

const area = {left: 0, top: 25, width: 1440, height: 875};

test('history keeps five successful inputs, canonical URL duplicates move to front', () => {
  let history = [];
  for (let i = 0; i < 7; i++) history = addHistory(history, `query ${i}`, i, `id${i}`);
  assert.deepEqual(history.map(x => x.input), ['query 6', 'query 5', 'query 4', 'query 3', 'query 2']);
  history = addHistory(history, 'example.com', 8, 'domain');
  history = addHistory(history, 'https://example.com/', 9, 'same-domain');
  assert.equal(history.length, 5);
  assert.equal(history.filter(x => x.kind === 'url').length, 1);
  assert.equal(history[0].id, 'same-domain');
  assert.equal(removeHistory(history, 'same-domain').length, 4);
  assert.deepEqual(cleanHistory([{id:'x',input:'javascript:alert(1)',updatedAt:1}, null, 'bad']), []);
});

test('geometry keeps normal bounds, handles negative monitors and unplugged displays', () => {
  const remembered = { left: -1200, top: 40, width: 600, height: 500 };
  assert.deepEqual(restoredBounds(remembered, {left:-1440,top:25,width:1440,height:875}, LAUNCHER_SIZE), remembered);
  assert.deepEqual(restoredBounds(remembered, area, LAUNCHER_SIZE), {...remembered, left: 0});
  assert.deepEqual(restoredBounds({left:9999,top:9999,width:3000,height:2000}, area, LAUNCHER_SIZE), area);
  assert.equal(normalBounds({...remembered,state:'maximized'}), null);
  assert.equal(normalBounds({...remembered,state:'minimized'}), null);
  assert.equal(normalBounds({...remembered,state:'fullscreen'}), null);
  assert.equal(normalBounds({...remembered,state:'normal',width:NaN}), null);
});

test('input validation exposes stable translatable codes and rejects credential URLs', () => {
  assert.throws(() => resolveInput(' '), /error_empty/);
  assert.throws(() => resolveInput('https://a:b@example.com'), /error_credentials/);
  assert.throws(() => resolveInput('data:text/html,hello'), /error_scheme/);
  assert.equal(resolveInput('中文 查一下').kind, 'search');
  assert.equal(resolveInput('localhost:3000').url, 'http://localhost:3000/');
});

let sequence = 0;
async function harness(previous) {
  const local = previous?.local || {};
  const session = previous?.session || {};
  const windows = previous?.windows || new Map();
  const tabs = previous?.tabs || new Map();
  const listeners = {};
  let nextId = 100;
  const event = name => ({addListener:fn => {listeners[name] = fn;}});
  const store = data => ({
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter(key => key in data).map(key => [key, structuredClone(data[key])]));
    },
    async set(values) {Object.assign(data,structuredClone(values));},
    async remove(key) {delete data[key];}
  });
  const chrome = {
    runtime: {
      id:'test', getURL:name => `chrome-extension://test/${name}`,
      async getContexts(filter) {
        return [...tabs.values()]
          .filter(tab => filter.tabIds.includes(tab.id) && filter.windowIds.includes(tab.windowId) &&
            filter.documentUrls.includes(tab.url) && filter.frameIds.includes(0) && !tab.incognito)
          .map(tab => ({tabId:tab.id,windowId:tab.windowId,frameId:0,incognito:false,documentId:`doc-${tab.id}`,documentUrl:tab.url}));
      },
      onMessage:event('message'),onInstalled:event('installed'),async sendMessage() {}
    },
    storage:{local:store(local),session:store(session)},
    commands:{onCommand:event('command')},action:{onClicked:event('action')},
    tabs: {
      async get(id) {if (!tabs.has(id)) throw Error('missing'); return structuredClone(tabs.get(id));},
      async update(id, props) {Object.assign(tabs.get(id), props);return structuredClone(tabs.get(id));},
      async create() {}
    },
    search:{async query({text,tabId}) {tabs.get(tabId).url = `https://search.example/?q=${encodeURIComponent(text)}`;}},
    windows:{
      onBoundsChanged:event('bounds'),onRemoved:event('removed'),
      async get(id) {if (!windows.has(id)) throw Error('missing');return structuredClone(windows.get(id));},
      async getLastFocused() {return {id:1,type:'normal',state:'normal',...area};},
      async create(props) {
        const id = nextId++;
        const tabId = id + 1000;
        const tab = {id:tabId,windowId:id,url:props.url};
        tabs.set(tabId,tab);
        const win = {id,state:'normal',...props,tabs:[tab]};
        windows.set(id,win);
        return structuredClone(win);
      },
      async update(id, props) {
        const win = windows.get(id);if (!win) throw Error('missing');
        Object.assign(win,props);
        listeners.bounds(structuredClone(win));
        return structuredClone(win);
      },
      async remove(id) {
        windows.delete(id);
        for (const [tabId,tab] of tabs) if(tab.windowId === id) tabs.delete(tabId);
        listeners.removed(id);
      }
    }
  };
  globalThis.chrome = chrome;
  await import(`../background.js?case=${sequence++}`);
  const setup = {id:'test',url:chrome.runtime.getURL('setup.html'),tab:{id:2,windowId:1}};
  const senderFor = winId => {
    const tab = [...tabs.values()].find(t => t.windowId === winId);
    return {id:'test',url:chrome.runtime.getURL('search.html'),tab:structuredClone(tab),frameId:0,documentId:`doc-${tab.id}`};
  };
  const message = (data,sender=setup) => new Promise(resolve => listeners.message(data,sender,resolve));
  const drain = () => message({type:'get-state'});
  const launch = async () => {
    assert.equal((await message({type:'open-launcher'})).ok,true);
    const id = session.launcher.windowId;
    assert.equal((await message({type:'launcher-ready',screen:area},senderFor(id))).ok,true);
    return id;
  };
  return {local,session,windows,tabs,listeners,chrome,message,senderFor,launch,drain};
}

test('backend bounds persistence distinguishes roles, ignores foreign windows, survives worker restart', async () => {
  let h = await harness();
  const id = await h.launch();
  const launcherGeometry = {left:120,top:130,width:700,height:520};
  await h.chrome.windows.update(id,launcherGeometry);
  await h.drain();
  assert.deepEqual(h.local.launcherBounds, launcherGeometry);
  assert.equal((await h.message({type:'browse',input:'example.com',screen:area},h.senderFor(id))).ok,true);
  const browserGeometry = {left:190,top:170,width:900,height:650};
  await h.chrome.windows.update(id,browserGeometry);
  await h.drain();
  assert.deepEqual(h.local.browserBounds,browserGeometry);
  assert.deepEqual(h.local.launcherBounds,launcherGeometry);
  h.listeners.bounds({id:999,type:'normal',state:'normal',left:1,top:2,width:500,height:400});
  h.listeners.bounds({id:998,type:'popup',state:'normal',left:1,top:2,width:500,height:400});
  await h.drain();
  assert.deepEqual(h.local.browserBounds,browserGeometry);
  h = await harness(h);
  await h.chrome.windows.update(id,{left:250});
  await h.drain();
  assert.deepEqual(h.local.browserBounds,{...browserGeometry,left:250});
  await h.chrome.windows.update(id,{state:'maximized',left:0,top:0,width:1440,height:900});
  await h.drain();
  assert.deepEqual(h.local.browserBounds,{...browserGeometry,left:250});
});

test('backend rejects failed/unauthorized history, keeps recent five, supports delete/clear', async () => {
  const h = await harness();
  let id = await h.launch();
  const original = h.chrome.search.query;
  h.chrome.search.query = async () => {throw Error('internal service unavailable');};
  assert.deepEqual(await h.message({type:'browse',input:'failed query',screen:area},h.senderFor(id)),{ok:false,error:'error_generic'});
  assert.equal(h.local.history,undefined);
  assert.equal(h.session.trackedWindows[id].role,'launcher');
  h.chrome.search.query = original;
  assert.equal((await h.message({type:'browse',input:'not allowed',screen:area})).ok,false);
  for(let i=0;i<7;i++) {
    id = await h.launch();
    assert.equal((await h.message({type:'browse',input:`search ${i}`,screen:area},h.senderFor(id))).ok,true);
  }
  let state = await h.drain();
  assert.deepEqual(state.history.map(x=>x.input),['search 6','search 5','search 4','search 3','search 2']);
  await h.message({type:'history-remove',id:state.history[0].id});
  assert.equal((await h.drain()).history.length,4);
  await h.message({type:'history-clear'});
  assert.deepEqual((await h.drain()).history,[]);
  const outsider = {id:'malicious',url:'chrome-extension://test/setup.html'};
  assert.equal((await h.message({type:'set-language',language:'zh_CN'},outsider)).ok,false);
  assert.equal((await h.message({type:'set-language',language:'zh_CN'})).language,'zh_CN');
  assert.equal((await h.message({type:'set-language',language:'bogus'})).error,'error_language');
});

test('Back-restored old launcher does not unregister a newer launcher', async () => {
  const h = await harness();
  const oldId = await h.launch();
  const oldTab = h.session.launcher.tabId;
  await h.message({type:'browse',input:'example.com',screen:area},h.senderFor(oldId));
  const newerId = await h.launch();
  h.tabs.get(oldTab).url = h.chrome.runtime.getURL('search.html');
  await h.message({type:'launcher-ready',screen:area},h.senderFor(oldId));
  assert.equal(h.session.launcher.windowId,newerId);
  await h.message({type:'close-launcher'},h.senderFor(oldId));
  await h.drain();
  assert.equal(h.session.launcher.windowId,newerId);
  assert.equal(h.session.trackedWindows[oldId],undefined);
});


test('rejected offscreen creation retries safely then repairs remembered bounds', async () => {
  const h = await harness();
  h.local.launcherBounds = {left:-9000,top:-9000,width:9000,height:8000};
  const original = h.chrome.windows.create;
  const attempts = [];
  h.chrome.windows.create = async props => {
    attempts.push(props);
    if (props.left === -9000) throw Error('OS rejected offscreen bounds');
    return original(props);
  };
  const id = await h.launch();
  assert.equal(attempts.length,2);
  assert.equal(attempts[1].left,undefined);
  assert.equal(attempts[1].top,undefined);
  assert.equal(attempts[1].width,LAUNCHER_SIZE.width);
  assert.equal(attempts[1].height,LAUNCHER_SIZE.height);
  assert.deepEqual(h.local.launcherBounds,area);
  assert.equal(h.windows.get(id).left,area.left);
  assert.equal(h.windows.get(id).width,area.width);
});


test('older Chrome scrubbed tab URLs still authorize live documents and reuse a cold launcher', async () => {
  const h = await harness();
  const realGet = h.chrome.tabs.get;
  h.chrome.tabs.get = async id => {const tab=await realGet(id);delete tab.url;return tab;};
  const realContexts = h.chrome.runtime.getContexts;
  let initialMisses=2;
  h.chrome.runtime.getContexts = async filter => initialMisses-- > 0 ? [] : realContexts(filter);
  const results=await Promise.all(Array.from({length:8},()=>h.message({type:'open-launcher'})));
  assert.ok(results.every(result=>result.ok));
  assert.equal(h.windows.size,1);
  const id=h.session.launcher.windowId;
  assert.equal((await h.message({type:'launcher-ready',screen:area},h.senderFor(id))).ok,true);
  assert.equal((await h.message({type:'browse',input:'example.com',screen:area},h.senderFor(id))).ok,true);
  assert.equal(h.local.history[0].input,'example.com');
});

test('request document proof rejects stale documents, missing identities and wrong frames', async () => {
  const h=await harness();
  const id=await h.launch();
  const legitimate=h.senderFor(id);
  for (const change of [{documentId:'old-document'},{documentId:undefined},{frameId:1},{url:'https://example.com/'}]) {
    const response=await h.message({type:'browse',input:'example.com',screen:area},{...legitimate,...change});
    assert.deepEqual(response,{ok:false,error:'error_stale'});
  }
  h.tabs.get(legitimate.tab.id).url='https://example.com/';
  assert.deepEqual(await h.message({type:'browse',input:'example.org',screen:area},legitimate),{ok:false,error:'error_stale'});
  assert.equal(h.local.history,undefined);
});

test('a focus failure preserves the existing launcher instead of duplicating it', async () => {
  const h=await harness();
  const id=await h.launch();
  h.chrome.windows.update=async()=>{throw Error('transient window activation error');};
  assert.deepEqual(await h.message({type:'open-launcher'}),{ok:false,error:'error_generic'});
  assert.equal(h.windows.size,1);
  assert.equal(h.session.launcher.windowId,id);
});
