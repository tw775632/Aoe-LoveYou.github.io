// ===== #1497 界面级回归：关闭手机输入法后的「回弹及时 + 不丝滑逆转」=====
// 背景（作者 2026-09-30 复报，红米 K80 Chrome 起报、明说其他机型同现）：
//   ①聊天里点开联系人互动卡→就地输入文字→提交后关闭输入法，回弹仍很慢；
//   ②其他输入栏关闭输入法，回弹也慢、不丝滑。
// 根因（本尺量的就是它）：「全高读数要不要顶住」在 #1487 初稿里被写成
//   (收缩拍<3 ‖ 2.5s 迟滞 ‖ 实测在场) 的**或式**——②在任何一次回弹后必然成立，
//   于是诚实内核（读数可信）也被顶住；而顶住分支会把 .phone 写回「键盘期稳态高」
//   ＝页面先跟动画升上去、再被按回键盘期高度（用户所见「不丝滑」），迟滞到点才真正展开
//   （「回弹慢」；纯 HEAD 实测 880ms，时间线 489→…→800→489→…→''）。
// #1497 把三份证据按权威性排成三级：实测尺已武装→尺说了算；尺没武装→收缩拍≥3＝诚实内核，
//   读 base 即真收，立即复原；收缩拍<3＝overlay 内核（只在弹出一瞬报一次收缩），聚焦期有界顶住 2.5s。
// 量法：页内 MutationObserver 记 .phone 内联高时间线（不靠轮询采样，snap-back 抓得住）。
// 用法：node tools/verify-1497-kb-close-rebound.mjs                                      （量当前产物）
//       MOCHI_ROOT=C:/Users/Administrator/m1497/r node tools/verify-1497-kb-close-rebound.mjs （量别版）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const PAGE = '/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 260) + ']' : ''));
}
function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
console.log('被测：' + root);
const jsMA = rd('js/mobile-adapt.js');
const jsChat = rd('js/chat.js');

// ---- 静态：契约锚点（删任一条＝对应回归回流）----
check('S1 证据按权威性排序·实测尺取数行（删＝回到「任一成立就顶住」，回弹慢复发）',
  jsMA.includes('var _vkHoldNow = _aVkHonest && (_aVkH >= 80 || Date.now() - _aVkArmAt < 600);'));
check('S2 诚实内核立即复原／overlay 才有界顶住（删＝诚实内核被迟滞顶住＝本次报障本体）',
  jsMA.includes('(!_aVkHonest && _aShrunkTicks < 3 && Date.now() - _aFullSince < 2500)'));
check('S3 或式旧写法已废（回流＝#1487a 初稿的判据写反原样复发）',
  !jsMA.includes('_aShrunkTicks < 3 || Date.now() - _aFullSince < 2500'));
check('S4 诚实/overlay 分类·收缩拍计数（删＝分类失效）', jsMA.includes('++_aShrunkTicks; return cur;'));
check('S5 轮询腿收口重置分类计数（删＝会话收口不清计数，下一会话沿用上一会话分类）',
  jsMA.includes('_aClosing = false; _aShrunkTicks = 0;'));
check('S6 轮询腿实测在场优先（#1486b 契约：硬证据说键盘还在就不拆会话）',
  jsMA.includes('if (_aVkHonest && (_aVkH >= 80 || Date.now() - _aVkArmAt < 600)) return;'));
check('S7 实测归零即时真收仍在（#1484c 契约：删＝尺说已收还被顶住）',
  jsMA.includes('else if (_aVkH < 80 && !_aFullSince) _aFullSince = 1;'));
check('S8 实测尺武装 600ms 空窗仍在（#1487c 契约：删＝武装瞬间空 rect 误判收＝整行遮挡）',
  jsMA.includes('if (!_aKb || Date.now() - _aVkArmAt < 600) return;'));
check('S9 #1462 就地作答提交前 blur＋报备不回退（报障①的第一现场）',
  jsChat.includes('try { inp.blur(); } catch (eKb) {}') && jsChat.includes('if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (eKd) {} }'));

// ---- 行为：假 visualViewport 驱动（无 VirtualKeyboard API＝诚实内核模型）----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const fail2 = (msg) => { try { require('node:fs').writeSync(2, msg + '\n'); } catch (e) {} };
if (!browserPath) { fail2('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (30600 + Math.floor(Math.random() * 300));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1497-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const EVAL_ERRS = [];
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  fail2('无法连接无头浏览器'); process.exit(2);
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      const d = String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 220);
      EVAL_ERRS.push(d); console.log('  [eval err] ' + d);
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const FAKE_VV = `(function(){
  var vv = { height: 844, width: 390, scale: 1, offsetTop: 0, offsetLeft: 0, _ls: {},
    addEventListener: function (t, f) { (vv._ls[t] = vv._ls[t] || []).push(f); },
    removeEventListener: function () {},
    scrollTo: function () {},
    dispatch: function (t) { (vv._ls[t] || []).slice().forEach(function (f) { try { f(); } catch (e) {} }); } };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: function () { return vv; } });
  // 诚实内核模型＝没有 VirtualKeyboard 实测通道（Firefox/旧内核/未暴露此 API 的壳）
  try { Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, get: function () { return undefined; } }); } catch (e) {}
  window.__fakeVV = vv;
  return 1;
})()`;

async function boot() {
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_VV });
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  await sleep(2500);
  for (let i = 0; i < 90; i++) {
    const ok = await evalJs("(function(){return !!window.__fakeVV && !!document.querySelector('.phone');})()");
    if (ok) return true;
    await sleep(300);
  }
  return false;
}
const H = "(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()";
const setVV = (h) => evalJs("(function(){window.__fakeVV.height=" + h + ";window.__fakeVV.dispatch('resize');return 1;})()");

// 页内时间线：MutationObserver 记 .phone 的 style 变化（不靠轮询采样，snap-back 不会被漏掉）
const RECORDER = `(function(){
  var ph=document.querySelector('.phone');
  window.__rec=[]; window.__t0=0;
  function push(){ if(!window.__t0)return; window.__rec.push([Date.now()-window.__t0, ph.style.height]); }
  new MutationObserver(push).observe(ph,{attributes:true,attributeFilter:['style']});
  window.__recStart=function(){ window.__rec=[]; window.__t0=Date.now(); push(); return 1; };
  window.__recMark=function(k){ if(!window.__t0)return 0; window.__rec.push(['m:'+k, Date.now()-window.__t0]); return 1; };
  window.__recDump=function(){ return JSON.stringify(window.__rec); };
  return 1;
})()`;

// 夹具诚实：确保可编辑元素真的活动聚焦（Chromium 无窗口焦点会吞 focusin，verify-1472/1481 同课）
async function ensureFocus() {
  for (let i = 0; i < 24; i++) {
    const ok = await evalJs("(function(){var t=document.getElementById('v1497-ed');if(!t)return false;try{t.focus();}catch(e){}return document.activeElement===t;})()");
    if (ok) return true;
    await sleep(120);
  }
  return false;
}
// 无头下活动焦点会自己掉（窗口不给焦点时内核会 blur）——600ms 续聚焦，与 verify-1486 同款
const startArm = () => evalJs("(function(){if(window.__arm)return 1;window.__arm=setInterval(function(){var t=document.getElementById('v1497-ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}if(document.activeElement!==t){try{t.focus();}catch(e2){}}},600);return 1;})()");
const stopArm = () => evalJs("(function(){if(window.__arm){clearInterval(window.__arm);window.__arm=null;}return 1;})()");
const activeIsEd = () => evalJs("(function(){return document.activeElement===document.getElementById('v1497-ed');})()");
// vv 回基准那一发：派发 + 打标记在同一个求值里（不留 CDP 往返误差，否则回弹 30ms 会被算成 99999）
const setVVBase = (h) => evalJs("(function(){window.__fakeVV.height=" + h + ";window.__fakeVV.dispatch('resize');window.__recMark('vv-base');return 1;})()");

await cdpConnect();
if (!(await boot())) { fail2('页面未就绪'); browser.kill(); process.exit(2); }
await cdp('Page.bringToFront');
await sleep(300);
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1497-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);return 1;})()");
const foc1 = await ensureFocus();
await startArm();
await evalJs(RECORDER);
check('F1 夹具自证：可编辑元素真持活动焦点（软键盘会话成立的前提）', foc1 === true, foc1);

// ================= B1/B2/B3 诚实内核：弹键盘（多拍收缩）→ 关键盘（逐帧回弹）=================
for (const h of [790, 720, 650, 580, 520, 489]) { await setVV(h); await sleep(45); }
await sleep(260);
const b1 = await evalJs(H);
check('B1 诚实内核弹键盘：多拍收缩后钉高＝键盘期可视高 489px（两侧同绿＝夹具自证）', b1 === '489px', b1);
const focB = await activeIsEd();

await evalJs('window.__recStart()');
for (const h of [560, 640, 720, 800]) { await setVV(h); await sleep(45); }
await setVVBase(844);
await sleep(1700);
const rec = JSON.parse((await evalJs('window.__recDump()')) || '[]');
const tBase = (rec.find((r) => r[0] === 'm:vv-base') || [null, null])[1];
const timed = rec.filter((r) => typeof r[0] === 'number');
const firstClear = timed.find((r) => r[1] === '' && r[0] >= tBase);
const reboundMs = (firstClear && tBase !== null) ? firstClear[0] - tBase : 99999;
// snap-back：时间线里出现过「≥790px 或已被清空」之后又落回 <500px（＝被按回键盘期高度）
let sawHigh = false, snappedBack = false, snapAt = null;
for (const s of timed) {
  const px = parseInt(s[1], 10);
  if (s[1] === '' || px >= 790) sawHigh = true;
  if (sawHigh && px > 0 && px < 500) { snappedBack = true; snapAt = s; break; }
}
check('B2 回弹及时：vv 回到 base 后 ≤400ms 内 .phone 已真展开（纯 HEAD 实测 869ms＝必红；报障②本体）',
  reboundMs <= 400, { reboundMs, foc: focB, timeline: timed.map((r) => r[0] + '→' + (r[1] || '(空)')).join(' ') });
check('B3 不丝滑逆转：升上去/展开之后不得再被按回键盘期高度（纯 HEAD 序列 489→800→489＝必红；报障「不丝滑」本体）',
  !snappedBack, { snappedBack, snapAt });

// ================= B4 失焦路径（＝聊天就地作答提交、问问TA收键盘那条路）=================
// 单侧控制项：这条路基线也快（focusout 400ms 复查兜着），本批只许更快、不许变慢。
for (const h of [790, 700, 600, 489]) { await setVV(h); await sleep(45); }
await sleep(220);
const b4open = await evalJs(H);
await stopArm();
await evalJs("(function(){var t=document.getElementById('v1497-ed');if(t){try{t.blur();}catch(e){}}return document.activeElement!==t;})()");
await evalJs("(function(){try{document.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));}catch(e){}return 1;})()");
await evalJs('window.__recStart()');
for (const h of [560, 680, 800]) { await setVV(h); await sleep(45); }
await setVVBase(844);
await sleep(1500);
const rec4 = JSON.parse((await evalJs('window.__recDump()')) || '[]');
const t4 = (rec4.find((r) => r[0] === 'm:vv-base') || [null, null])[1];
const t4c = (rec4.filter((r) => typeof r[0] === 'number').find((r) => r[1] === '' && r[0] >= t4) || [])[0];
const b4ms = t4c === undefined ? 99999 : t4c - t4;
check('B4 失焦路径（单侧控制项，基线 191ms／两侧都该快）≤400ms 内展开，本批不得变慢',
  b4open === '489px' && b4ms <= 400, { open: b4open, ms: b4ms, timeline: rec4.filter((r) => typeof r[0] === 'number').map((r) => r[0] + '→' + (r[1] || '(空)')).join(' ') });
await startArm();

// ================= B5 overlay 内核（只在弹出一瞬报一次收缩）＝#1481/#1487 契约不得破 =================
await setVV(844);
await sleep(500);
await ensureFocus();
await sleep(700);
// 真机 overlay 签名＝「收缩一瞬、随即回全高」：两次派发放同一个求值里，中间不留拍
//（留空隙会被 250ms 轮询多记几次收缩拍，把 overlay 内核误判成诚实内核）
const b5o = await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');var p=document.querySelector('.phone').style.height;window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return p;})()");
await sleep(1100);
const b5foc = await activeIsEd();
const b5hold = await evalJs(H);
check('B5 overlay 内核毛刺回全高：聚焦期仍顶住 360px（纯 HEAD 800ms 迟滞已拆会话＝必红；删＝GT7/K80「空白↔遮挡反复切换」复发）',
  b5o === '360px' && b5hold === '360px', { open: b5o, hold: b5hold, foc: b5foc });
await sleep(2000);
const b5late = await evalJs(H);
check('B5b overlay 顶住是有界的：顶住窗口到点后收起（永久顶住＝整行永远被盖）', b5late === '', b5late);

check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

try { ws.close(); } catch (e) {}
try { browser.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const pass = results.filter((r) => r.ok).length;
console.log('\n===== 合计 ' + pass + ' 通过 / ' + (results.length - pass) + ' 失败 =====');
process.exit(pass === results.length ? 0 : 1);
