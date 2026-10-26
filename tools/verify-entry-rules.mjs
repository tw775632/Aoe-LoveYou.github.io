// ===== 专项验证：#1578 入站须知（开屏公告前的一次性入站确认层） =====
// 用例组：
//   A 首次打开（未通过）：须知整页在场、.splash 挂 eqz-active、.splash-box 被收起、进度 0/8
//   B 答题交互：单选覆盖、重点已选项不抖动、进度实时
//   C 有错/漏答提交：结果页列出「未作答」与「本题只有 1 个正确答案」；「重新确认」清空重答
//   D 全对提交：须知层移除、开屏公告恢复可见、根键 xy-home-v2:rules-notice-pass 落盘
//   E 只答一次：刷新后不再出现；reset（模拟改版）后重新出现
//   F 24 题入站问卷不受影响：mochiEntryQuizGate 仍在、mochiEntryQuizPassed()===false、entry-quiz-pass 键未被写
// 注：无头环境需伪装 UA（去 Headless）＋ webdriver=false，否则入口闸的自动化放行会跳过整层（同 #1576 探针坑位）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
if (!jsFiles.includes('entry-rules.js')) { console.error('✗ entry-rules.js 未登记进 build.mjs jsFiles'); process.exit(1); }
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
const probeTs = Date.now();
testHtml = testHtml.split('__BUILD_INFO__').join('verify-entry-rules').split('__BUILD_TS__').join(String(probeTs)).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-entry-rules-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-entry-rules-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(3500); }
// 伪装成普通桌面 Chrome（去 Headless 字样）＋ webdriver=false——入口闸的自动化放行按这两项判定
await cdpConnect();
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});" });
await cdp('Page.enable');

const CORRECT = [1, 1, 1, 0, 2, 0, 1, 0];
const clickOpt = (i, j) => evalJs(`(function(){var o=document.querySelector('#entry-rules-page .eqz-opt[data-i="${i}"][data-j="${j}"]');if(!o)return 'no-opt';o.click();return 'ok';})()`);
const GATE = `(function(){return {
  page: !!document.getElementById('entry-rules-page'),
  active: !!document.querySelector('#splash.eqz-active'),
  boxHidden: (document.getElementById('splash-box') ? getComputedStyle(document.getElementById('splash-box')).display === 'none' : null),
  progress: (document.getElementById('nrz-progress') || {}).textContent || null,
  resultShown: (function(){var v=document.getElementById('nrz-view-result');return v? !v.hidden : null;})(),
  resultText: (function(){var v=document.getElementById('nrz-view-result');return v? v.textContent : '';})(),
  selCount: document.querySelectorAll('#entry-rules-page .eqz-opt.is-sel').length,
  passKey: (function(){try{return localStorage.getItem('xy-home-v2:rules-notice-pass');}catch(e){return null;}})(),
  quiz24Passed: typeof window.mochiEntryQuizPassed === 'function' ? window.mochiEntryQuizPassed() : null,
  quiz24Gate: typeof window.mochiEntryQuizGate === 'function',
  quiz24Key: (function(){try{return localStorage.getItem('xy-home-v2:entry-quiz-pass');}catch(e){return null;}})(),
  jsErr: (window.__jsErrors || []).length
};})()`;

// ===== A/B：首次打开 + 答题交互 =====
console.log('A/B 首次打开与答题交互');
await navigate(baseUrl + '/index.html');
let s = await evalJs(GATE);
ok('A1 须知整页在场', s.page === true);
ok('A2 .splash 挂 eqz-active（同层收起方案，无新遮罩）', s.active === true);
ok('A3 .splash-box 被收起（公告在须知层下不可见）', s.boxHidden === true);
ok('A4 初始进度 已答 0 / 8', s.progress === '已答 0 / 8');
ok('A0 页面无 JS 异常', s.jsErr === 0, s.jsErr);
s = await evalJs(GATE); // 提交前状态复查
ok('B1 第1题选B（正确项）→ is-sel 且进度 1/8', (await clickOpt(0, 1)) === 'ok');
let s2 = await evalJs(GATE);
ok('B2 选中态 1 个、进度 1/8', s2.selCount === 1 && s2.progress === '已答 1 / 8', s2);
await clickOpt(0, 1);
s2 = await evalJs(GATE);
ok('B3 重点已选单选项不抖动（仍 1 个选中）', s2.selCount === 1 && s2.progress === '已答 1 / 8', s2);
await clickOpt(0, 0); // 改选 A（单选覆盖，后面 C 组当错答用）
s2 = await evalJs(GATE);
ok('B4 单选覆盖：改选 A 后仍只有 1 个选中', s2.selCount === 1 && s2.progress === '已答 1 / 8', s2);

// #1583 一题一屏：主按钮兼「下一步」，提交前必须连点到「最终确认」步再点一次提交
async function submitAll() {
  await evalJs(`(function(){
    var go=document.getElementById('nrz-confirm');
    for (var i=0;i<40 && go;i++) {
      if (/接受以上规则/.test(go.textContent||'')) break;
      go.click();
    }
    if (go) go.click();
    return true;
  })()`);
}

// ===== C：漏答＋错答提交 → 结果页 → 重新确认 =====
console.log('C 漏答/错答提交与重新确认');
for (let i = 1; i < 8; i++) { if (i !== 4) await clickOpt(i, CORRECT[i]); } // 第2题起全对，第5题(i=4)留空
await submitAll();
s = await evalJs(GATE);
ok('C1 提交后跳结果页', s.resultShown === true);
ok('C2 报「还有 2 题需要重新确认」', s.resultText.indexOf('还有 2 题需要重新确认') > -1, s.resultText.slice(0, 80));
ok('C3 含「未作答」（第5题）', s.resultText.indexOf('未作答') > -1);
ok('C4 含「本题只有 1 个正确答案」（第1题错答，不泄露答案）', s.resultText.indexOf('本题只有 1 个正确答案') > -1);
ok('C5 结果页不含任何正确答案字面', s.resultText.indexOf('正常使用，按站内规则来') === -1);
await evalJs(`document.getElementById('nrz-retry').click(); true`);
s = await evalJs(GATE);
ok('C6 重新确认＝清空重答（回答题页、0 选中、进度 0/8）', s.resultShown === false && s.selCount === 0 && s.progress === '已答 0 / 8', s);

// ===== D：全对提交 → 放行 =====
console.log('D 全对提交放行');
for (let i = 0; i < 8; i++) await clickOpt(i, CORRECT[i]);
await submitAll();
s = await evalJs(GATE);
ok('D1 须知层移除', s.page === false);
ok('D2 .splash 的 eqz-active 已摘除', s.active === false);
ok('D3 开屏公告恢复可见', s.boxHidden === false);
ok('D4 放行根键落盘（v=2026-10-22c）', typeof s.passKey === 'string' && s.passKey.indexOf('"v":"2026-10-22c"') > -1, s.passKey);
ok('F1 24题问卷闸未被放行（mochiEntryQuizPassed()===false）', s.quiz24Passed === false, s.quiz24Passed);
ok('F2 24题问卷闸本体仍在（mochiEntryQuizGate）', s.quiz24Gate === true);
ok('F3 24题问卷放行键未被误写', s.quiz24Key === null, s.quiz24Key);

// ===== E：只答一次（刷新不重现；reset 模拟改版后重现） =====
console.log('E 只答一次');
await navigate(baseUrl + '/index.html');
s = await evalJs(GATE);
ok('E1 刷新后须知不再出现', s.page === false && s.active === false);
ok('E2 刷新后公告直接可见', s.boxHidden === false);
// 模拟「须知改版」：写入更旧版本记录（LS＋IDB 双写；reset 只清 LS 会被 idbRestore 从 IDB 回填，
// 与 entry-quiz 的 reset 同一口径）。记录版本 < 本页版本＝拦下重答（#1572 版本比较语义）。
// #1585：cookie 也是放行记录的一路，模拟改版必须同清，否则「cookie 仍是新版」＝本来就该放行。
await evalJs(`(function(){var old=JSON.stringify({t:Date.now(),v:'2026-01-01'});
  try{document.cookie='mochi_rnp=; max-age=0; path=/';}catch(e){}
  try{if(window.xyStore)window.xyStore('xy-home-v2').set('rules-notice-pass',old);}catch(e){}
  try{localStorage.setItem('xy-home-v2:rules-notice-pass',old);}catch(e){}
  return true;})()`);
await navigate(baseUrl + '/index.html');
s = await evalJs(GATE);
ok('E3 记录版本更旧（模拟改版）后须知重新出现', s.page === true && s.active === true, s);

// ===== K：只答一次的三路冗余（#1585 iQOO11 / Edge「答了 10 遍、每次重开都要重答」）=====
// 根因不是机型：本页的闸在模块加载瞬间判，而启动回填是异步的 → 记录只在 IndexedDB 的机器上，
// 开门那一刻同步读空＝判成没答过。修法＝cookie（同步、独立配额）＋内存/LS＋IDB 三路 + 开层前异步问库。
console.log('K 三路冗余（cookie / 内存·LS / IndexedDB）');
await navigate(baseUrl + '/index.html');
await evalJs(`window.__entryRulesTest.pass(), true`);
const CK_GET = `(function(){var m=document.cookie.match(/(?:^|;\\s*)mochi_rnp=([^;]*)/);return m?decodeURIComponent(m[1]):null;})()`;
const ck = await evalJs(CK_GET);
ok('K1 通过时 cookie 同步落盘（v=2026-10-22c）', ck === '2026-10-22c', ck);
// 模拟报障机：LS 写不进/被清 + cookie 也没了，记录只剩 IndexedDB 一份
await evalJs(`(function(){
  try{localStorage.removeItem('xy-home-v2:rules-notice-pass');}catch(e){}
  try{document.cookie='mochi_rnp=; max-age=0; path=/';}catch(e){}
  return true;})()`);
await navigate(baseUrl + '/index.html');
s = await evalJs(GATE);
ok('K2 只剩 IDB 记录时不再要求重答（报障机情形）', s.page === false && s.active === false, s);
ok('K2b 命中后顺手把 LS/cookie 补回（下次同步即命中）', (await evalJs(CK_GET)) === '2026-10-22c', await evalJs(CK_GET));
// K3 反向：库里只剩旧版记录（LS/cookie 已清）→ 仍须重答一次（版本语义没被放宽）
await evalJs(`(function(){var old=JSON.stringify({t:Date.now(),v:'2026-01-01'});
  try{if(window.xyStore)window.xyStore('xy-home-v2').set('rules-notice-pass',old);}catch(e){}
  try{localStorage.removeItem('xy-home-v2:rules-notice-pass');}catch(e){}
  try{document.cookie='mochi_rnp=; max-age=0; path=/';}catch(e){}
  return true;})()`);
await navigate(baseUrl + '/index.html');
s = await evalJs(GATE);
ok('K3 库里只剩旧版记录时仍会重答一次（闸没被放宽）', s.page === true && s.active === true, s);

// ===== G：一题一屏的可达性（#1583 作者要求覆盖全部机型）=====
// 小视口下不再依赖滚动：断言任何时刻只有一屏内容、连点「下一步」即可走到第 8 题与提交按钮，
// 且全程 .splash 的 scrollTop 保持 0（＝根本不需要滚动）。
console.log('G 一题一屏可达性（390x660 视口 · 不依赖滚动）');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 660, deviceScaleFactor: 2, mobile: true });
await navigate(baseUrl + '/index.html');
s = await evalJs(GATE);
ok('G1 小视口下须知层在场', s.page === true && s.active === true);
const PGINFO = `(function(){
  var sp=document.getElementById('splash');
  var go=document.getElementById('nrz-confirm');
  var intro=document.getElementById('nrz-intro');
  function qs(){ return Array.prototype.slice.call(document.querySelectorAll('#entry-rules-page .eqz-q[data-i]')); }
  function visCount(){ return qs().filter(function(q){ return !q.hidden; }).length; }
  var intro0 = intro && !intro.hidden;
  var vc0 = visCount();
  var q8 = document.querySelector('#entry-rules-page .eqz-q[data-i=\\"7\\"]');
  var n = 0;
  while (n < 12 && q8 && q8.hidden) { go.click(); n++; }
  var vh = window.innerHeight;
  var r8 = q8 ? q8.getBoundingClientRect() : null;
  var vc1 = visCount();
  var scrolled = sp ? Math.round(sp.scrollTop) : -1;
  go.click(); // 进入最终确认步
  var fin = document.getElementById('nrz-final');
  var rb = document.getElementById('nrz-confirm').getBoundingClientRect();
  return JSON.stringify({
    intro0:intro0, vc0:vc0, steps:n, vc1:vc1, scrolled:scrolled,
    q8: r8 ? { top:Math.round(r8.top), bottom:Math.round(r8.bottom), inView:(r8.top>=0 && r8.bottom<=vh) } : null,
    finShown: !!(fin && !fin.hidden),
    btn: { top:Math.round(rb.top), bottom:Math.round(rb.bottom), inView:(rb.top>=0 && rb.bottom<=vh) },
    prevEnabled: !document.getElementById('nrz-prev').disabled
  });
})()`;
const g = JSON.parse(await evalJs(PGINFO) || 'null');
ok('G2 规则说明步：只有说明可见、8 题全隐藏', g && g.intro0 === true && g.vc0 === 0, g);
ok('G3 连点「下一步」8 次即到第 8 题（无需滚动）', g && g.steps === 8 && g.vc1 === 1, g);
ok('G4 第 8 题在可视区内且全程未滚动（scrollTop=0）', g && g.q8 && g.q8.inView && g.scrolled === 0, g);
ok('G5 最终确认步：提交按钮在可视区（底栏常驻）', g && g.finShown === true && g.btn.inView === true, g);
ok('G6 「上一步」可用（可回看上一题）', g && g.prevEnabled === true, g);
await cdp('Emulation.clearDeviceMetricsOverride');

// #1583 页头自检入口：点一下必须真的摊出本机几何数据（这是后续定位现场的唯一依据）
console.log('I 页头自检入口');
const diag = JSON.parse(await evalJs(`(function(){
  var b=document.getElementById('nrz-diag-btn'); if(!b) return JSON.stringify({btn:false});
  b.click();
  var p=document.getElementById('nrz-diag');
  return JSON.stringify({btn:true, shown: !!p && p.hidden===false, text: p?p.textContent:''});
})()`) || 'null');
ok('I1 自检按钮在场且点击后展开面板', !!(diag && diag.btn === true && diag.shown === true), diag && { btn: diag.btn, shown: diag.shown });
ok('I2 面板含真实几何数据（#splash/scrollH/第8题/置底尝试）',
  !!(diag && /#splash:/.test(diag.text) && /scrollH=/.test(diag.text) && /第8题:/.test(diag.text) && /置底尝试:/.test(diag.text)));

// ===== J：#1584 可视高/安全区（作者两台机：①开屏看不见「我已阅读并知晓」 ②须知页只看得到选项、看不到题目）=====
// J1~J3 针对「页面画进系统状态栏区、env() 恒报 0」的形态（Android 15+ 边缘到边 / 内嵌浏览器）：
//   须知页顶部必须让开状态栏（题目标题不得被盖住）；开屏高度必须取实测可视高（底栏不得落到可视区外）。
// J4~J5 针对「整个底部操作区在可视区外」：整页高度＝可视高，且万一内容仍超高，.splash 自身可滚到底。
console.log('J 可视高 / 安全区（#1584）');
{
  // 当前状态＝I 组结束时：须知层开着（390×660）。先量顶部避让：模拟边缘到边把 --mochi-safe-top 写成 31px。
  const j1 = JSON.parse(await evalJs(`(function(){
    var d=document.documentElement;
    var page=document.getElementById('entry-rules-page');
    d.style.removeProperty('--mochi-safe-top');
    var before=parseFloat(getComputedStyle(page).paddingTop)||0;
    d.style.setProperty('--mochi-safe-top','31px');
    var pad=parseFloat(getComputedStyle(page).paddingTop)||0;
    var sc=document.getElementById('nrz-scroll');
    var qTop=sc?Math.round(sc.getBoundingClientRect().top):null;
    return JSON.stringify({before:before, pad:pad, qTop:qTop});
  })()`));
  ok('J1 常态下问卷页顶内边距为 0（--mochi-safe-top 未设＝正常机零变化）', j1 && j1.before === 0, j1);
  ok('J2 边缘到边（safe-top=31px）下题目标题让开状态栏（滚动区 top ≥ 31）', !!(j1 && j1.pad >= 31 && j1.qTop >= 31), j1);

  // 放行须知 → 刷新 → 开屏重新露出，在 390×400 的矮视口量开屏底栏可达性
  await evalJs('window.__entryRulesTest.pass(); true');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 400, deviceScaleFactor: 2, mobile: true });
  await navigate(baseUrl + '/index.html');
  await sleep(1200);
  const j3 = JSON.parse(await evalJs(`(function(){
    var sp=document.getElementById('splash');
    var card=document.querySelector('.splash-footcard');
    var ent=document.getElementById('splash-enter');
    var vv=window.visualViewport?Math.round(window.visualViewport.height):window.innerHeight;
    var spH=Math.round(sp.getBoundingClientRect().height);
    var varH=getComputedStyle(document.documentElement).getPropertyValue('--mochi-vv-h').trim();
    function r(n){ if(!n) return null; var b=n.getBoundingClientRect(); return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height)}; }
    var c0=r(card), e0=r(ent);
    var canScroll=sp.scrollHeight-sp.clientHeight;
    var reached=true;
    if (c0 && c0.bottom>spH+1) { sp.scrollTop=sp.scrollHeight; reached=(sp.scrollTop>0); c0=r(card); e0=r(ent); }
    return JSON.stringify({vv:vv, spH:spH, varH:varH, canScroll:canScroll,
      card:c0, ent:e0, ok1:(c0?c0.bottom<=spH+1:false), ok2:(e0?e0.bottom<=spH+1:false), scrolled:reached});
  })()`));
  ok('J3 开屏高度＝实测可视高（不是布局视口）', !!(j3 && j3.varH === j3.vv + 'px' && Math.abs(j3.spH - j3.vv) <= 1), j3);
  ok('J4 矮视口（390×400）下底部操作卡整块在可视区内（按钮必然可达）', !!(j3 && j3.ok1 === true && j3.card && j3.card.h > 0), j3 && { card: j3.card, ent: j3.ent });
  ok('J5 内容仍超高时开屏可滚到底（.splash 自身兜底滚动）', !!(j3 && (j3.canScroll <= 0 || j3.scrolled === true)), j3 && { canScroll: j3.canScroll, scrolled: j3.scrolled });
  await cdp('Emulation.clearDeviceMetricsOverride');
}

// #1582 强制刷新弹窗的「本版一次性强提醒」通道：用旧构建号页面隔离验证——
// 该页同目录 version.json 与页面同号（版本比对通道判不出新版），弹窗只可能来自强提醒通道。
console.log('H 强制刷新弹窗·本版一次性强提醒（旧构建号页面）');
{
  const OLD_TS = 1792655277595; // 2026-10-22 15:47 那一版（#1581）的构建 ts
  const oldDir = join(tmpRoot, 'old');
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, 'index.html'), testHtml.split('data-build-ts="' + probeTs + '"').join('data-build-ts="' + OLD_TS + '"'));
  writeFileSync(join(oldDir, 'version.json'), JSON.stringify({ ts: OLD_TS, info: 'probe-old' }));
  await cdp('Runtime.evaluate', { expression: "try{localStorage.removeItem('xy-home-v2:update-remind-force')}catch(e){}" });
  await navigate(baseUrl + '/old/index.html');
  const h1 = JSON.parse(await evalJs(`(function(){
    var sv=document.getElementById('splash-ver');
    var w=document.getElementById('update-remind-wrap');
    var d=w?w.querySelector('.ur-d'):null;
    return JSON.stringify({ ts: sv?sv.getAttribute('data-build-ts'):null,
      shown: !!w, btn: !!(w&&w.querySelector('.ur-go')),
      titled: !!(w&&/2026\.10\.23/.test((w.querySelector('.ur-t')||{}).textContent||'')),
      bodyHit: !!(d&&/第 8 题/.test(d.textContent||'')) });
  })()`));
  ok('H1 旧构建号页面弹出强制刷新弹窗（不依赖 version.json 比对）', h1 && h1.ts === String(OLD_TS) && h1.shown === true, h1);
  ok('H2 弹窗标题/按钮指向 2026.10.23 且正文提到两个问题的修复', h1 && h1.titled === true && h1.bodyHit === true && h1.btn === true, h1);
  const h2 = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:update-remind-force')}catch(e){return null}})()");
  ok('H3 强提醒标记落盘（本版只提醒一次）', h2 === '2026-10-23a', h2);
  // H4 同会话重复调用不叠加第二层（弹窗自带 done 去重；这里不重载页面——探针对同一 URL 连续导航不稳）
  const h3 = JSON.parse(await evalJs(`(function(){
    window.mochiUpdateRemindShow && window.mochiUpdateRemindShow();
    return JSON.stringify({ n: document.querySelectorAll('#update-remind-wrap').length });
  })()`));
  ok('H4 重复调用不叠加第二层弹窗（同会话去重）', h3 && h3.n === 1, h3);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
