// ===== 常驻回归：#iOS 卡顿（v3.27.x 台6）跨桌面聊天写入「空闲合并 + 生命周期兜底」 =====
// 根因：chatAppendToDeskMsg / chatAppendDeskRec / chatDeskCardReply 原把整条 chat-msgs
//（可达数百 KB~MB）同步 JSON.stringify + localStorage.setItem。TA 回应/后台通知/卡片
// 答复落到「非当前桌面」时在 promise 直写＝单次数百 ms 长任务，与用户打字/收键盘/翻页撞车，
// 多型号（含 iOS 各版本）均有卡顿报障。
// 修法（数据语义零变化，只改「何时写」）：①同一桌面多张追加卡合并成一次
//「读权威→守卫→追加→写」＝不再每张各串化整包；②整体推迟到 requestIdleCallback 空闲窗；
// ③退后台/切桌面/离页（flushDeskWritesNow）强制兜底，绝不因推迟丢消息。写入器
// idbSet(JSON)+LS 快照+#90 账本全保留，守卫（读失败绝不写回 / idbHasKey 严格三态 /
// deskAppendMissGuard 账本复核）逐字不动。
// 断言（判别器＝让红侧必红）：
//  S 组＝产物源锚（红侧必红）：S1 window.flushDeskWritesNow 为全局函数
//  D 组＝本批缺陷面（绿过红红）：
//    D1 连发 3 条非当前桌面追加后、flush 前，该桌面 chat-msgs 键被 idbGet 读取次数为 0
//       （新＝延迟合并写；旧实现＝每条立即读改写，≥1 直接红）
//    D3 flushDeskWritesNow() 后该键恰被 idbGet 读取 1 次（新＝3 条合并成单读；旧＝3 次→红）
//    D4 完整性：flush 后该键＝base5 + 追加 3 条、顺序保留、chat-meta 账本在
//    D5 全新空桌面 miss 路径：append 1 条后 flush 能建出新数组恰好含该条（守卫放行）
//    D6 chatDeskCardReply：对已种 ask 卡 rec 调 reply 后 flush，status==='answered' 且回应
//       气泡已并入（卡片读改写惰性顺延进空闲窗，语义不变）
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-deskwrite-coalesce.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9910 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-desk-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 3).join(' | ').slice(0, 200));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1000);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(1000);
  for (let i = 0; i < 30; i++) {
    if (await evalJs("typeof window.createContact === 'function' && typeof window.idbGet === 'function' && typeof window.idbSet === 'function'")) break;
    await sleep(400);
  }
}
async function reloadClean() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
}
// 轮询直到 asyncCheck() 返回真 / 超时。asyncCheck 内抛错按「未满足」处理。
async function poll(desc, asyncCheck, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs('(' + asyncCheck + ')()');
    if (v && v !== 'EVAL_ERR:null') { const r = await evalJs('(' + asyncCheck + ')()'); if (r) return r; }
    await sleep(120);
  }
  return null;
}

await reloadClean();

// ---- 场景1：待写合并（判别器核心）----
// 阶段：createContact 建非当前桌面 cid；active 桌面保持 default。种 base5 + 账本。
const s1 = await evalJs(`(async function(){
  try {
    var cid = window.createContact('测试桌面');
    var pk = 'xy-home-v2:' + cid;
    var t0 = Date.now() - 86400000;
    var base = [];
    for (var i = 0; i < 5; i++) base.push({ side: i%2?'in':'out', text: 'base'+i, ts: t0 + i*60000 });
    await window.idbSet(pk + ':chat-msgs', base);
    localStorage.setItem(pk + ':chat-msgs', JSON.stringify(base));
    var meta = JSON.stringify({ n: 5, b: 0 });
    await window.idbSet(pk + ':chat-meta', meta); localStorage.setItem(pk + ':chat-meta', meta);
    // monkeypatch idbGet：只统计该桌面 chat-msgs 键的读取次数，其余转发原函数
    window.__origIdbGet = window.idbGet;
    window.__deskGetCount = 0;
    window.__countKey = pk + ':chat-msgs';
    window.idbGet = function (k) {
      if (k === window.__countKey) window.__deskGetCount++;
      return window.__origIdbGet.apply(null, arguments);
    };
    // 连发 3 条非当前桌面追加（不切桌面，active 仍是 default）
    window.chatAppendDeskRec(cid, { side: 'out', text: 'r1', ts: t0 + 600000 });
    window.chatAppendToDeskMsg(cid, 'hi', {});
    window.chatAppendDeskRec(cid, { side: 'in', text: 'r3', ts: t0 + 1200000 });
    // 同一同步块内立即读计数：空闲调度器无论 rIC 还是 setTimeout 都不会同步触发
    var cntBefore = window.__deskGetCount;
    return JSON.stringify({ cid: cid, pk: pk, cntBefore: cntBefore, active: window.__activeCid || 'default' });
  } catch (e) { return 'ERR:' + e; }
})()`);
let J1 = null; try { J1 = JSON.parse(s1 || '{}'); } catch (e) {}
if (!J1 || !J1.pk) { console.error('场景1 建桌面失败: ' + s1); chrome.kill(); server.close(); process.exit(1); }
const COUNT_KEY = J1.pk + ':chat-msgs';
check('S1  expose  window.flushDeskWritesNow 全局函数', await evalJs("typeof window.flushDeskWritesNow === 'function'"));
check('P1  active 桌面仍是 default', J1.active === 'default', J1.active);
check('D1  flush 前 该桌面 chat-msgs 键 idbGet 读取次数 = 0（旧=每条即读⇒≥1）', J1.cntBefore === 0, 'cnt=' + J1.cntBefore);

// flush → 合并单读落盘
await evalJs("try { window.flushDeskWritesNow(); } catch (e) {}");
// 轮询直到账本/数组落定（写发生在 idbGet.then 异步内）
const s2 = await poll('读回 len', `(function(){ return new Promise(function(res){
  window.__origIdbGet(${JSON.stringify(COUNT_KEY)}).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    res(Array.isArray(a) && a.length === 8); // base5 + r1 + poke + r3
  }).catch(function(){ res(false); });
}); })()`, 5000);
const s3 = await evalJs(`(async function(){
  try {
    var a = await window.__origIdbGet(${JSON.stringify(COUNT_KEY)});
    if (typeof a === 'string') a = JSON.parse(a);
    var textSeq = a.map(function(r){ return r.text; });
    var poke = a.filter(function(r){ return r.special === 'poke'; });
    var meta = await window.__origIdbGet(${JSON.stringify(J1.pk)} + ':chat-meta');
    return JSON.stringify({ len: a.length, textSeq: textSeq, poke: poke.length, meta: !!meta, cnt: window.__deskGetCount });
  } catch (e) { return 'ERR:' + e; }
})()`);
let J3 = null; try { J3 = JSON.parse(s3 || '{}'); } catch (e) {}
check('D3  flush 后 该键恰被 idbGet 读取 1 次（旧=3 次合并读完）', J3 && J3.cnt === 1, J3 && 'cnt=' + J3.cnt);
check('D4  落盘完整性：len==8 且顺序 base0..base4,r1,poke,r3，账本在',
  J3 && J3.len === 8 && !!J3.meta,
  J3 ? ('len=' + J3.len + ' seq=' + JSON.stringify(J3.textSeq)) : 'null');
check('D4b poke 以小纸条(poke)形态入库（沿用原 special）', J3 && J3.poke === 1, J3 && 'poke=' + J3.poke);

// ---- 场景2：全新空桌面 miss 路径（守卫放行，不覆盖）----
const s4 = await evalJs(`(async function(){
  try {
    var cid2 = window.createContact('空桌面');
    var pk2 = 'xy-home-v2:' + cid2;
    window.chatAppendDeskRec(cid2, { side: 'in', text: 'only', ts: Date.now() });
    try { window.flushDeskWritesNow(); } catch (e) {}
    return JSON.stringify({ pk2: pk2 });
  } catch (e) { return 'ERR:' + e; }
})()`);
let J4 = null; try { J4 = JSON.parse(s4 || '{}'); } catch (e) {}
const D5_KEY = J4 ? J4.pk2 + ':chat-msgs' : null;
const d5Check = D5_KEY ? `(function(){ return new Promise(function(res){
  window.idbGet(${JSON.stringify(D5_KEY)}).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    res(Array.isArray(a) && a.length === 1 && a[0].text === 'only');
  }).catch(function(){ res(false); });
}); })()` : '()=>false';
const s5 = await poll('读回空桌面 len', d5Check, 5000);
check('D5  全新空桌面 append 一条后 flush 能建出新数组且仅含该条', !!s5, '');

// ---- 场景3：chatDeskCardReply 卡片答复顺延进空闲窗（语义不变）----
const s6 = await evalJs(`(async function(){
  try {
    var cid3 = window.createContact('卡桌面');
    var pk3 = 'xy-home-v2:' + cid3;
    var kt = Date.now() - 30000;
    var base = [
      { side: 'out', text: '问过', ts: kt - 60000, askStatus: 'pending' },
      { side: 'in', special: 'ask', text: '你会答吗', ts: kt, askStatus: 'pending' },
      { side: 'out', text: '后话', ts: kt + 60000 }
    ];
    await window.idbSet(pk3 + ':chat-msgs', base);
    localStorage.setItem(pk3 + ':chat-msgs', JSON.stringify(base));
    window.chatDeskCardReply(cid3, 'ask', kt, 'askStatus',
      function (rec) { rec.askStatus = 'answered'; rec.askAnswer = '我会'; },
      [{ side: 'in', text: '我会答', special: 'answer-bubble' }],
      function () { window.__d6back = true; });
    try { window.flushDeskWritesNow(); } catch (e) {}
    return JSON.stringify({ pk3: pk3, kt: kt, back: !!window.__d6back });
  } catch (e) { return 'ERR:' + e; }
})()`);
let J6 = null; try { J6 = JSON.parse(s6 || '{}'); } catch (e) {}
const D6_KEY = J6 ? J6.pk3 + ':chat-msgs' : null;
const d6Check = D6_KEY ? `(function(){ return new Promise(function(res){
  window.idbGet(${JSON.stringify(D6_KEY)}).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(a)) { res(false); return; }
    var card = a.filter(function(r){ return r.ts === (${JSON.stringify(J6.kt)}) && r.special === 'ask'; })[0];
    var bubble = a.filter(function(r){ return r.special === 'answer-bubble'; })[0];
    res(!!card && card.askStatus === 'answered' && card.askAnswer === '我会' && !!bubble);
  }).catch(function(){ res(false); });
}); })()` : '()=>false';
const s7 = await poll('读回卡桌面', d6Check, 5000);
check('D6  cardReply 落库：卡 status==answered 且回应气泡已并入', !!s7, J6 && 'onBack未触发=' + (!J6.back));
check('Z1  全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));

console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail + (jsExcepts.length ? '  异常记录 ' + jsExcepts.length : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail > 0 ? 1 : 0);