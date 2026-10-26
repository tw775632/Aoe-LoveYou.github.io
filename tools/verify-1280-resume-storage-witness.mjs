// ===== 常驻回归脚本 #1280：回前台 / 退出重进，聊天里新消息不显示（#1067→#1202→本批第三、四面）=====
// 用法：node tools/verify-1280-resume-storage-witness.mjs [被测根目录]
// 症状（用户实报 2026-09-25，红米 K80 + Chrome，明说其他设备型号也有出现、要求别按机型打补丁）：
//   ①「把浏览器放后台一段时间再切回来，聊天里新的聊天消息还是不显示、显示空白，刷新网页之后才正常」
//   ②「或者退出聊天功能页面，重新打开聊天功能，试了两次，新的聊天消息才正常显示」
// 前两发治了什么：#1067＝长离场（>60s）回前台补一发 `loadMsgs(true)`（绕时间闸）；#1202＝那一发被
//   在飞的整窗构建打掉后「永不再来」⇒ 换成有界复核状态机。两发都只在**回前台**这一条路上做文章。
// 本批量的是同一症状里它们没覆盖的两面（零机型／零 UA 分支＝判据只取存储事实与时序）：
//   第三面 B2「退出重进」：进聊天页那一发是**普通** loadMsgs()，会被两道时间闸吃掉——
//     · `IDB_RELOAD_MIN_GAP=8000`（同桌面 8s 内不重读权威）
//     · #952 的 `_lmChainBusy` 12s 链在飞去重（命中时**整条 loadMsgs 直接 return**，连 LS 快照都不并）
//     · #954 热片会话缓存（10 分钟内 blk-idx/热块内存直取＝另一上下文写进 IDB 的那几条根本不去问）
//   回前台/切桌面/预热任何一发读都会把这三道闸重新上弦 ⇒ 用户「退出聊天再进来」恰好落在闸内＝
//   第一次必然看不见，第二次（过了 8s）才有＝用户原话②「要试两次」。**读没读由时间闸决定，而不是由
//   「盘上到底有没有新东西」决定**，这就是本批要改的判据。
//   第四面 B1「只留在共享存储里的那一条」：写那条消息的上下文没赶上把它落进 IDB（整包/热片落盘是
//   空闲合并＋最小 2.5s 间隔，进程被冻结/杀掉那一下这条链就断），那条只存在于**共享 localStorage**
//   （<pfx>:chat-msgs 快照＋:chat-tail 尾巴日志，每条新消息同步写、必达）。本 tab 读这两键走
//   xyStore＝内存缓存优先（idb.js get：`key in memoryCache` 即返回本会话自己那份），会话内只要本
//   tab 自己写过这两键，别人后来写进 LS 的那一份就被永久遮蔽；loadMsgs 里的 LS 快照合并又只在
//   `!chatDbReady` 才跑 ⇒ 回前台怎么重读都读不到，只有刷新（冷启动缓存为空、真读 LS）才恢复＝原话①。
// 夹具纪律（沿用 #1067/#1202，复用者必读）：
//   ① A 在「后台期」把收消息＋落盘入口整体静音（真机冻住的页面既收不到也写不了；不静音则 A 自己的
//      整包写回会覆盖 B 的写入＝最后写入者赢，把读侧断言变成写侧竞态）；
//   ② 第四面的写侧 B 先摘掉 idbSet/idbSetAll 再写＝那条只进共享 LS、不进 IDB（落盘没赶上的等价形态），
//      写完立刻关掉 B＝那个上下文再也不会补写；
//   ③ 写侧标签页要在断言前**预先起好**（bootTab 约 8s），临时起页会掉出 8s 闸外＝测不到第三面；
//   ④ 遮蔽前提用 P 组显式坐实（直读 LS 看得见 / 走本会话缓存读不到），前提不成立时 B1 是假绿——
//      本轮若 P4 报红，说明这条形态在纯 HEAD 上没被构造出来，B1 的绿不能当作「这一面已修好」的证据。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 250);
  }
}
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 400) : '')); } };

console.log('静态断言（本批新契约的锚；纯基线侧天然全红）:');
let src = '', prod = '';
try { src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prod = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
A_('S1 存在「直读共享 localStorage 第二副本」的读口（源）', /function chatLsTruth\b/.test(src));
A_('S2 存在「盘上比内存新」的存储凭据判定（源）', /function chatStoreAhead\b/.test(src));
A_('S3 凭据成立时绕时间闸补一发权威重读（源）', /chatStoreAhead\([\s\S]{0,600}?loadMsgs\(true\)/.test(src));
A_('S4 进聊天页与回前台挂同一凭据（源）', /chatStoreFreshen\(/.test(src));
A_('S5 尾巴日志读值取「两份里更新的那一份」（源）', /function chatTailTruth\b/.test(src));
A_('S6 上述机制在产物里在位（产物）', /function chatStoreAhead\b/.test(prod) && /function chatLsTruth\b/.test(prod) && /function chatTailTruth\b/.test(prod));
A_('S7 凭据有「只为更晚的那一条开一枪」的水位线（源；删＝同一未落地凭据逐次绕闸重读大键）', /if \(t <= _aheadFired\) continue;/.test(src));
A_('S8 水位线按命名空间归零（源；删＝切桌面后旧桌面水位盖住新桌面的凭据，同 #766 跨联系人一族）', /if \(p !== _aheadFiredPfx\) \{ _aheadFiredPfx = p; _aheadFired = 0;/.test(src));
A_('S9 尾巴并集只认「比内存那份最新一条更晚」的（源；删＝#766 回收掉的旧条目被复活再喂一遍回放链＝同一条固化成两条）', /if \(memMax && !\(t > memMax\)\) continue;/.test(src));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9811 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1280-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

function mkClient(wsUrl, tag) {
  const c = { tag, pend: new Map(), id: 0, errors: [], ws: null };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl);
    c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String(m.params.exceptionDetails.text || '').slice(0, 120)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) { console.error('  [' + tag + ' eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}
async function listTargets() { return (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json()); }
async function waitCdp() {
  for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } }
  throw new Error('CDP 端口未就绪: ' + cdpPort);
}
async function openTab(url) {
  const r = await fetch('http://127.0.0.1:' + cdpPort + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  return await r.json();
}
async function closeTab(id) { try { await fetch('http://127.0.0.1:' + cdpPort + '/json/close/' + id); } catch (e) {} }

async function bootTab(client, url) {
  await client.cdp('Page.enable'); await client.cdp('Runtime.enable');
  await client.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
  await client.cdp('Page.navigate', { url });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await client.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await client.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(500);
  await client.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");
  // 关掉两条自主产消息源（自动回复 / TA 的提问·选择·好奇·吐槽卡定时器）：与「另一上下文落库」抢同一份
  // chat store（最后写入者赢）会把读侧断言变成写侧竞态。
  await client.evalJs(`(function(){
    try { var st = window.activeStore(); st.set('cs-rp-auto-prob', '0'); } catch (e) {}
    ['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){
      try { var st = window.activeStore(); var d = null; try { d = JSON.parse(st.get(k) || 'null'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = {}; if (!d.settings || typeof d.settings !== 'object') d.settings = {};
        d.settings.enabled = false; st.set(k, JSON.stringify(d)); } catch (e) {}
    });
    return true;
  })()`);
}

// 回场驱动：覆写 visibilityState 后派发事件（产品读的就是事件契约），派发完还原真实描述符
const GO = (state) => `(function(){
  try {
    if (${JSON.stringify(state)} === 'hidden') { window.__origVS = Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') || Object.getOwnPropertyDescriptor(document,'visibilityState'); }
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return ${JSON.stringify(state)};}});
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const RESUME = (ageMs) => `(function(){
  try {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}});
    window.__chatHiddenAgeMs = ${ageMs};
    document.dispatchEvent(new Event('visibilitychange'));
    window.__chatHiddenAgeMs = null;
    if (window.__origVS) { Object.defineProperty(document,'visibilityState',window.__origVS); window.__origVS = null; }
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
// 后台期把 A 的「收消息＋落盘」入口静音（真机冻住的页面本来就收不到也写不了）
const MUTE = `(function(){
  try {
    window.__fixt = { inW: window.chatAddIn, sysW: window.chatAddSystem, typedW: window.chatAddInTyped, setW: window.idbSet, setAllW: window.idbSetAll };
    window.chatAddIn = function(){ return null; };
    window.chatAddSystem = function(){ return null; };
    if (window.chatAddInTyped) window.chatAddInTyped = function(){};
    window.idbSet = function(){ return Promise.resolve(); };
    if (window.idbSetAll) window.idbSetAll = function(){ return Promise.resolve(); };
    // 真机「整页冻结」的第二半：把 A 此刻已排队的定时器一律摘掉（自动回复/心情卡/戳一戳/预热都是
    // setTimeout/setInterval 驱动的）。不摘则 A 在「后台期」照产消息——内存尾部反而比盘上更新，
    // 本批判据要判的那件事（盘上有一条内存里没有的）就被夹具自己搅浑（实测 B2 因 ts 口径漏读、
    // B1e 因回场后又冒出一条心情卡而 153px 不贴底）。摘完之后新排的定时器照常跑＝只冻过去不冻将来。
    for (var i = 1; i < 6000; i++) { try { clearTimeout(i); clearInterval(i); } catch (e2) {} }
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const UNMUTE = `(function(){
  try { var f = window.__fixt || {}; if (f.inW) window.chatAddIn = f.inW; if (f.sysW) window.chatAddSystem = f.sysW;
    if (f.typedW) window.chatAddInTyped = f.typedW; if (f.setW) window.idbSet = f.setW; if (f.setAllW) window.idbSetAll = f.setAllW;
    window.__fixt = null; } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
// 写侧标签页 B 的一条新消息；lsOnly＝摘掉 IDB 落盘（整包没赶上／进程被杀的等价形态）
const WRITE = (mark, lsOnly) => `(function(){
  try {
    if (${lsOnly ? 'true' : 'false'}) {
      window.idbSet = function(){ return Promise.resolve(); };
      if (window.idbSetAll) window.idbSetAll = function(){ return Promise.resolve(); };
    }
    window.chatAddIn(${JSON.stringify(mark)}, {});
    return String(window.getChatMsgs().length);
  } catch (e) { return 'ERR:' + e.message; }
})()`;

const CHAT_APPS = `(function(){var a=document.querySelector('.app[data-app="chat"]');if(a){a.click();return 'ok';}return 'no-app';})()`;
const CHAT_BACK = `(function(){var b=document.getElementById('chat-back');if(b){b.click();return 'ok';}return 'no-back';})()`;
const SNAP = `(function(){
  var b=document.getElementById('chat-body');
  if(!b) return JSON.stringify({err:1});
  var last=-1, kids=b.children;
  for (var i=kids.length-1;i>=0;i--){ var v=kids[i]&&kids[i].dataset?parseInt(kids[i].dataset.idx,10):NaN; if (isFinite(v)){ last=v; break; } }
  return JSON.stringify({ kids:kids.length, last:last, n:(window.getChatMsgs?window.getChatMsgs().length:-1),
    gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight), text:(b.textContent||'').slice(-70) });
})()`;
const HAS = (mark) => `(function(){var b=document.getElementById('chat-body');return b?b.textContent.indexOf(${JSON.stringify(mark)})>=0:false;})()`;
const COUNT = (mark) => `(function(){var b=document.getElementById('chat-body');if(!b)return -1;var n=0;var kids=b.children;
  for(var i=0;i<kids.length;i++){ if(((kids[i].textContent)||'').indexOf(${JSON.stringify(mark)})>=0) n++; } return n;})()`;
// 同一份存储的两个视角：store（本会话内存缓存优先）vs 直读共享 localStorage
const LS_VIEW = (mark) => `(function(){
  var m = ${JSON.stringify(mark)}, out = {};
  try {
    var pfx = window.activePrefix();
    var sk = window.activeStore();
    ['chat-msgs', 'chat-tail'].forEach(function (k) {
      var s = '', r = '';
      try { s = String(sk.get(k) || ''); } catch (e) {}
      try { r = String(localStorage.getItem(pfx + ':' + k) || ''); } catch (e) {}
      var camel = k === 'chat-msgs' ? 'msgs' : 'tail';
      out[camel + 'Store'] = s.indexOf(m) >= 0;
      out[camel + 'Raw'] = r.indexOf(m) >= 0;
    });
  } catch (e) { out.err = String(e && e.message || e); }
  return JSON.stringify(out);
})()`;
// 第四面前提的两步（顺序要紧）：先把「本 tab 自己那一份」取下来（此刻还没污染任何存储），
// 等别家上下文把新条目写进共享 LS、并且关掉之后，再把这份**旧值**灌回本会话内存缓存
// ＝真机「本 tab 落过盘、且冻结期间没收到跨上下文失效通知」的等价形态。
// 为什么不能像早期版本那样「写之前先灌」：无头两标签页同进程，B 的 LS 写入会给 A 派发
// storage 事件，而 idb.js 的跨上下文同步正是靠它删掉被遮蔽的缓存键——先灌后写＝前提被自家
// 事件当场拆掉（实测 lsViewPre 四个 true）。真机上冻住的标签页不跑监听、事件也不补投，
// 且不少内核压根不派发（PWA 与浏览器双开、进程被杀后重启＝根本没有那个上下文）。
// 灌回时摘掉 idbSet：这步只是让内存缓存变旧，绝不许把旧值反灌进库（否则变成写侧竞态）。
const CAPTURE_OWN = () => `(function(){
  try {
    var sk = window.activeStore();
    window.__staleSeed = { m: String(sk.get('chat-msgs') || '[]'), t: String(sk.get('chat-tail') || '[]') };
    return JSON.stringify({ m: window.__staleSeed.m.length, t: window.__staleSeed.t.length });
  } catch (e) { return 'ERR:' + e.message; }
})()`;
const SEED_STALE = () => `(function(){
  try {
    var s = window.__staleSeed || {};
    var keep = window.idbSet, keepAll = window.idbSetAll;
    // 只让内存缓存变旧：这一趟不许碰共享存储（idbSet 摘掉＝不反灌库；setItem/removeItem 摘掉
    // ＝不把别人刚写进 LS 的那一份盖掉。真机等价形态：本 tab 那一次落盘发生在别人写入之前）
    var kSet = localStorage.setItem, kDel = localStorage.removeItem;
    window.idbSet = function(){ return Promise.resolve(); };
    window.idbSetAll = function(){ return Promise.resolve(); };
    try {
      localStorage.setItem = function(){};
      localStorage.removeItem = function(){};
      window.activeStore().set('chat-msgs', String(s.m || '[]'));
      window.activeStore().set('chat-tail', String(s.t || '[]'));
    } finally {
      localStorage.setItem = kSet; localStorage.removeItem = kDel;
      window.idbSet = keep; window.idbSetAll = keepAll;
    }
    return 'ok';
  } catch (e) { return 'ERR:' + e.message; }
})()`;
const IDB_HAS = (mark) => `(function(){
  var m = ${JSON.stringify(mark)};
  return window.idbGetAllKeys().then(function(keys){
    var ks = (keys || []).filter(function(k){ return /chat-(msgs|arch|blk|tail)/.test(String(k)); });
    return Promise.all(ks.map(function(k){ return window.idbGet(k).then(function(v){ return String(v).indexOf(m) >= 0 ? String(k) : ''; }).catch(function(){ return ''; }); }))
      .then(function(hits){ var h = hits.filter(Boolean); return h.length ? h.join(',') : 'none'; });
  }).catch(function(){ return 'read-fail'; });
})()`;
const ARM_READS = `(function(){
  window.__histReads = [];
  if (!window.__idbGetRaw) window.__idbGetRaw = window.idbGet;
  var raw = window.__idbGetRaw;
  window.idbGet = function (k, o) { try { if (/chat-(msgs|blk-idx|arch|blk-\\d)/.test(String(k))) window.__histReads.push(String(k)); } catch (e) {} return raw.apply(this, arguments); };
  return true;
})()`;

let B = null;
try {
  await waitCdp();
  // 端口撞车护栏：这个端口上的浏览器若不是本脚本刚起的那个（开局应有且只有 1 个 about:blank），
  // 后续每个 CDP 调用都会静默挂死＝整支脚本假死（不是假红）。跑电池时每支给不同 MOCHI_CDP_PORT。
  const t0 = (await listTargets()).filter((t) => t.type === 'page');
  if (t0.length !== 1 || String(t0[0].url || '').indexOf('about:blank') < 0) {
    console.error('SKIP: CDP 端口 ' + cdpPort + ' 上不是本脚本刚起的浏览器（page 目标 ' + t0.length + ' 个）＝端口撞车，换 MOCHI_CDP_PORT 重跑');
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    process.exit(2);
  }
  let page = t0[0];
  const A = mkClient(page.webSocketDebuggerUrl, 'A'); await A.connect();
  await bootTab(A, baseUrl + '/index.html');
  await A.cdp('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await A.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await bootTab(A, baseUrl + '/index.html');

  const seeded = await A.evalJs(`(function(){
    try {
      var now = Date.now(), arr = [];
      for (var i = 0; i < 200; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3, '0'), ts: now - (200 - i) * 60000 });
      return window.chatImportMsgs(arr) ? 'true' : 'false';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  A_('P0 前提：200 条历史导入成功', seeded === 'true', seeded);
  await sleep(2500);
  await A.evalJs(CHAT_APPS);
  await sleep(3500);
  await A.evalJs('(function(){ try { window.chatSendMsg("我自己先发的一条"); } catch (e) {} return true; })()');
  await sleep(1500);
  await A.evalJs('(function(){ try { window.chatFlushSave && window.chatFlushSave(); } catch (e) {} return true; })()');
  await sleep(2500);
  let s0 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  // 贴底容差 48px：尾巴下可能挂着「戳一戳」提示条/输入中指示（高度 ~20-30px），它不影响本批判据
  A_('P1 前提：聊天页在贴底且已渲染（屏上尾部＝内存尾部）', !s0.err && s0.kids > 50 && s0.last >= s0.n - 2 && Math.abs(s0.gap) <= 48, s0);
  await A.evalJs(ARM_READS);

  // 写侧上下文预先起好（夹具纪律③：bootTab 约 8s，临时起页会掉出 8s 时间闸）
  const tB = await openTab(baseUrl + '/index.html');
  B = mkClient(tB.webSocketDebuggerUrl, 'B'); await B.connect();
  await bootTab(B, baseUrl + '/index.html');
  await B.cdp('Page.bringToFront');
  await B.cdp('Page.setWebLifecycleState', { state: 'active' });
  await sleep(500);
  await A.evalJs(CHAT_APPS); // A 此刻也在聊天页（第三面要量「退出去看一下再回来」）
  await sleep(2000);
  await A.evalJs(MUTE);     // A 从此刻起不再自己产消息/落盘（夹具纪律①）

  // ==================== 第三面 B2：时间闸内的「退出聊天页 → 重新进入」 ====================
  const MARK2 = '__MSG1280B__闸内那条';
  const w2 = await B.evalJs(WRITE(MARK2, false));
  const idb2 = await waitFor(async () => (await B.evalJs(IDB_HAS(MARK2))) !== 'none', 20000, 500);
  A_('P2 前提：另一上下文已把新消息正常落进 IDB（＝回场/重进本应读得到）', idb2.ok, { w2, idb2 });
  await B.cdp('Page.bringToFront');
  await sleep(400);
  await A.evalJs('window.__histReads.length = 0'); // 只量这一趟「退出→重进」读了什么
  await A.evalJs(CHAT_BACK);            // 用户：退出聊天功能页
  await sleep(700);
  await A.evalJs(CHAT_APPS);            // 用户：重新打开聊天功能（距上一发读库 ≈1s＝落在 8s 闸内）
  const saw2 = await waitFor(async () => (await A.evalJs(HAS(MARK2))) === true, 6000, 400);
  const s2 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('B2 【症状②】退出聊天页再进来（第一次、距上一发读库 ≈1s）就把新消息画上屏', saw2.ok, { saw2, s2, reads: await A.evalJs('JSON.stringify(window.__histReads)') });

  // ==================== 第四面 B1：那条只留在共享 localStorage（本会话缓存把它遮蔽） ====================
  const own = await A.evalJs(CAPTURE_OWN()); // 先取下「本 tab 自己那一份」，此刻不污染任何存储
  await A.evalJs('window.__histReads.length = 0');
  const MARK = '__MSG1280A__后台那条';
  await A.evalJs(GO('hidden'));
  const w1 = await B.evalJs(WRITE(MARK, true)); // lsOnly＝整包落盘没赶上
  await sleep(1500);
  const idbHit = await B.evalJs(IDB_HAS(MARK));
  A_('P4 前提：那条**没有**进 IDB（落盘没赶上／进程被杀的等价形态）', idbHit === 'none', { idbHit });
  await closeTab(tB.id); B = null;
  await sleep(400);
  await A.evalJs(SEED_STALE());         // B 已关＝不会再来 storage 事件把缓存拆新；此刻上弦＝永久遮蔽
  const lsViewPre = JSON.parse((await A.evalJs(LS_VIEW(MARK))) || '{}');
  A_('P3 前提：那条确实在共享 localStorage 里（直读看得见），而本会话缓存读不到＝遮蔽成立', (lsViewPre.msgsRaw === true || lsViewPre.tailRaw === true) && lsViewPre.msgsStore === false && lsViewPre.tailStore === false, { own, w1, lsViewPre });
  await A.evalJs(RESUME(65000));        // 长挂后台后回前台
  const saw1 = await waitFor(async () => (await A.evalJs(HAS(MARK))) === true, 20000, 400);
  const s1 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('B1 【症状①】回前台后，只留在共享存储里的那一条自己上了屏（不等刷新）', saw1.ok, { w1, saw1, s1, reads: await A.evalJs('JSON.stringify(window.__histReads)') });
  const bubbleTxt = await A.evalJs(`(function(){
    var b=document.getElementById('chat-body'); if(!b) return 'no-body';
    var n=null, kids=b.children;
    for (var i=kids.length-1;i>=0;i--){ if ((kids[i].textContent||'').indexOf(${JSON.stringify(MARK)})>=0){ n=kids[i]; break; } }
    if(!n) return 'no-node';
    var bb=n.querySelector('.msg-bubble')||n;
    return JSON.stringify({ txtLen:(bb.textContent||'').trim().length, txt:(bb.textContent||'').trim().slice(0,40) });
  })()`);
  let bt = {}; try { bt = JSON.parse(bubbleTxt); } catch (e) {}
  A_('B1b 补上来的气泡有文字（不是空白气泡）', bt.txtLen > 0 && String(bt.txt).indexOf('__MSG1280A__') >= 0, bubbleTxt);
  // 落定窗：waitFor 命中＝那一条刚上屏，此刻贴底/条数还在收敛（#1010 媒体解码收尾、#930 贴底复钉都是
  // 落地后再走一拍）。旧尺子在**同一时刻**读屏数、隔几毫秒又读 DOM 份，天然不自洽；本批判据是「回前台
  // 后最终贴底、只有一份」，所以先给 ≤2.5s 落定期、再用同一份读数同时判条数与贴底。
  const untilStable = Date.now() + 2500;
  let sFinal = s1, cntFinal = await A.evalJs(COUNT(MARK));
  for (;;) {
    const sv = JSON.parse((await A.evalJs(SNAP)) || '{}');
    const cv = await A.evalJs(COUNT(MARK));
    if (sv && !sv.err && Math.abs(sv.gap) <= 8 && cv === cntFinal) { sFinal = sv; cntFinal = cv; break; }
    sFinal = sv && !sv.err ? sv : sFinal;
    cntFinal = cv;
    if (Date.now() >= untilStable) break;
    await sleep(300);
  }
  A_('B1c 屏上尾部已追平内存尾部（无「内存有、屏上没有」的错位）', !sFinal.err && sFinal.last >= sFinal.n - 1, sFinal);
  A_('B1d 只补上**一份**（回放不许把同一条固化成多条＝#749/#766 契约）', cntFinal === 1, { n: cntFinal, model: sFinal.n });
  // B1e 的判据口径（本批复核修正）：这条 gap 不是本批带来的——同一夹具上走**常规新消息**那条路
  // （C3b，与本批机制无关）落定后的 gap 也是 22px，纯基线侧同样 22px（产物在这套无头仿真里
  // 「先钉后长高」的通用现场）。旧尺子拿绝对值 ≤8 当尺子，两侧同红＝与本批无关的存量噪声。
  // 本批不许打破的是**相对**语义：补读落进来的那一条，不许比常规新消息更不贴底，也不许整条被裁。
  const gapB1 = !sFinal.err && typeof sFinal.gap === 'number' ? Math.abs(sFinal.gap) : -1;

  // ==================== 对照组：既有契约不许被本批削弱 ====================
  await sleep(9000); // 让 B1 那一发的落盘/快照彻底安静
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(GO('hidden'));
  await sleep(500);
  await A.evalJs(RESUME(2000));
  await sleep(3000);
  const shortReads = await A.evalJs('JSON.stringify(window.__histReads)');
  A_('C1 对照组：短离场（2s）且盘上无更新 ⇒ 回前台零权威重读（#1067 C1／#1202 C4 契约）', shortReads === '[]', shortReads);

  await sleep(9000);
  await A.evalJs('window.__histReads.length = 0');
  for (let i = 0; i < 3; i++) { await A.evalJs(CHAT_BACK); await sleep(400); await A.evalJs(CHAT_APPS); await sleep(1200); }
  const churn = await A.evalJs('JSON.stringify(window.__histReads)');
  let churnN = -1; try { churnN = JSON.parse(churn).length; } catch (e) {}
  A_('C2 对照组：无新凭据时反复退出重进不逐次重读大键（时间闸没被拆掉＝#716/#722 血案不回潮）', churnN >= 0 && churnN <= 4, { churn });

  const MARK3 = '__MSG1280C__我自己刚发的';
  await A.evalJs(UNMUTE);
  await A.evalJs(`(function(){ try { window.chatAddIn(${JSON.stringify(MARK3)}, {}); } catch (e) {} return true; })()`);
  const saw3 = await waitFor(async () => (await A.evalJs(HAS(MARK3))) === true, 6000, 300);
  A_('C3 对照组：本 tab 自己收到的消息照旧立即上屏且只有一份', saw3.ok && (await A.evalJs(COUNT(MARK3))) === 1, { saw3, n: await A.evalJs(COUNT(MARK3)) });
  // C3b 取证性对照：常规「新消息上屏」落定后的贴底余量＝本夹具自己的通用现场（先钉后长高），
  // 用它当尺子量本批补读那一条：不许更差（≤常规＋4px），也不许整条气泡被裁（≤一条气泡高）。
  await sleep(1200);
  const s3 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  const gapNorm = !s3.err && typeof s3.gap === 'number' ? Math.abs(s3.gap) : -1;
  A_('B1e 回前台补上来的那一条最终贴底（相对常规新消息不打折、且不被整条裁掉）',
    gapB1 >= 0 && gapNorm >= 0 && gapB1 <= gapNorm + 4 && gapB1 <= 53,
    { gapB1: gapB1, gapNormal: gapNorm, sFinal: sFinal });
  console.log('  [读数] C3b 常规新消息落定后的 gap＝' + s3.gap + '（kids=' + s3.kids + ' n=' + s3.n + '）');

  await A.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await A.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await A.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(800);
  await A.evalJs(CHAT_APPS);
  const saw4 = await waitFor(async () => (await A.evalJs(HAS(MARK2))) === true, 15000, 500);
  // 对照组只量「不许补重」：那条 LS-only 的消息在纯 HEAD 上会被本 tab 的下一次整包写覆盖
  //（＝真机「刷新也没了」的第四种现场），所以这里断言 ≤1 份而不是「必须在」——「必须在」由 B1 量。
  const dupN = await A.evalJs(COUNT(MARK));
  A_('C4 对照组：刷新后落库那条仍在，且本批不许把「补读」变成「补重复」（≤1 份）', saw4.ok && dupN <= 1, { saw4, dupN });

  A_('Z1 主标签页零 JS 异常', A.errors.length === 0, A.errors.slice(0, 3));
  console.log('\n结果：绿 ' + pass + ' / 红 ' + fail);
} catch (e) {
  console.error('脚本异常：', e && e.message || e);
  fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);
