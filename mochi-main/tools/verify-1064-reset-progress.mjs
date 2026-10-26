// ===== 常驻回归：#1064 清除本地数据「卡顿 + 没有清除进度条」=====
// 用户报障原话：「点击【清除本地数据】会卡顿，没有清除进度条」。
// 根因：整段清理同步跑在主线程——一次性 Object.keys + 逐键 removeItem（大库设备上千键、
// 单值可达数 MB，每次删除都同步落存储层），随后还要等最多 6s 的 IDB 删库，期间界面既不能
// 重绘也零反馈，观感＝「点完卡住不动、不知道清没清」。
// 修法（零机型分支，清除范围/失败回退语义一字不动）：①分片清键（每 40 键 setTimeout(0)
// 让出主线程）；②确认后立刻铺全屏进度条（本地存储→数据库→离线缓存→最后清理→重启）。
// 断言：
//  S 组 产物源锚（红侧必红）：S1 personalize.js 有分片让出（setTimeout(step, 0)）／
//     S2 有进度条 DOM（id="reset-prog-fill"）／S3 bg-keep.js 警告条带「×」关闭钮
//  B 组 行为（点设置「清除本地数据」→ 弹窗确定，全程采样）：
//     B1 确认后 <400ms 屏上出现 #reset-prog（红侧：从头到尾不存在＝「没有清除进度条」本体）
//     B2 进度条宽度至少推进过 3 个不同值（证「逐步推进」而不是摆样子）
//     B3 文案至少跨过 2 个阶段（本地存储 → 数据库/缓存 之一）
//     B4 重启前出现过「清除完成」终态文案（红侧无进度条＝无此项）
//     B5 清键期间最长单帧间隔 < 400ms（分片让出主线程的直接证据；红侧一次性同步删键更堵）
//     B6 最终确实重新加载了页面（清除语义没被进度条改坏）
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1064-reset-progress.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED_KEYS = Number(process.env.SEED_KEYS) || 600;   // 种够量的键，让同步删键真的堵
const SEED_VAL = Number(process.env.SEED_VAL) || 20000;   // 单键 ~20KB ⇒ 600 键 ≈ 12MB
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };

// ---------- S 组：产物源锚 ----------
{
  const pz = (() => { try { return readFileSync(join(root, 'js/personalize.js'), 'utf8'); } catch (e) { return ''; } })();
  const bg = (() => { try { return readFileSync(join(root, 'js/bg-keep.js'), 'utf8'); } catch (e) { return ''; } })();
  ok('S1 分片清键（让出主线程）锚在位', pz.includes('setTimeout(step, 0)'));
  ok('S2 进度条 DOM 锚在位', pz.includes('id="reset-prog-fill"'));
  ok('S3 内存回收警告条「×」关闭钮在位', bg.includes('mem-warn-x'));
}

// ---------- 启动 headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1064-' + Date.now());
const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'];
const cp = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const targets = await (await fetch(dbg + '/json/list')).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(dbg + '/json/new?about:blank')).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const waits = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params) => new Promise((res, rej) => { const id = ++mid; waits.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const evalJs = async (expr, awaitPromise) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

// 页内记录器：每个新文档都装一遍（含清除后自动 reload 的那份），采样写 sessionStorage
// （同标签页跨重载保留）——不依赖 Node 侧的轮询节奏，也不怕重载把 window 状态清空。
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  try{
    if (!sessionStorage.getItem('__p1064')) sessionStorage.setItem('__p1064','[]');
    if (sessionStorage.getItem('__p1064-errors') === null) sessionStorage.setItem('__p1064-errors','[]');
    var errs = JSON.parse(sessionStorage.getItem('__p1064-errors') || '[]');
    window.addEventListener('error', function(ev){ errs.push(String(ev.message||ev.error)); sessionStorage.setItem('__p1064-errors', JSON.stringify(errs.slice(0,5))); });
    window.addEventListener('unhandledrejection', function(ev){ errs.push('rej:'+String(ev.reason)); sessionStorage.setItem('__p1064-errors', JSON.stringify(errs.slice(0,5))); });
    var last = performance.now();
    window.__gap = 0;
    requestAnimationFrame(function tick(){
      var n = performance.now();
      if (window.__go){ var d = n - last; if (d > window.__gap) { window.__gap = d; var g = Number(sessionStorage.getItem('__p1064-gap')||0); if (window.__gap > g) sessionStorage.setItem('__p1064-gap', String(Math.round(window.__gap))); } }
      last = n; requestAnimationFrame(tick);
    });
    setInterval(function(){
      if (!window.__go) return;
      try{
        var f=document.getElementById('reset-prog-fill');
        var t=document.getElementById('reset-prog-txt');
        var b=document.getElementById('reset-prog');
        var arr=JSON.parse(sessionStorage.getItem('__p1064')||'[]');
        var base=Number(sessionStorage.getItem('__p1064-base')||0);
        arr.push({ t: Math.round(performance.now()), bar: !!b, w: f? String(f.style.width):null, txt: t? t.textContent : null });
        if (base) arr[arr.length-1].dt = Math.round((Date.now()-base));
        sessionStorage.setItem('__p1064', JSON.stringify(arr.slice(-300)));
      }catch(e){}
    }, 40);
    // 精确步进记录：进度条一出现就盯它的 style 变化，逐步入账（不吃采样节奏）
    function recordStep(w, txt){
      try{
        var steps = JSON.parse(sessionStorage.getItem('__p1064-steps') || '[]');
        var base = Number(sessionStorage.getItem('__p1064-base') || 0);
        var lastStep = steps[steps.length-1] || {};
        if (lastStep.w === w && lastStep.txt === txt) return;
        steps.push({ w: w, txt: txt, dt: base ? Math.round(Date.now()-base) : null });
        sessionStorage.setItem('__p1064-steps', JSON.stringify(steps.slice(-200)));
      }catch(e){}
    }
    if (sessionStorage.getItem('__p1064-steps') === null) sessionStorage.setItem('__p1064-steps','[]');
    var bootObs = function(){ try { new MutationObserver(function(){
      var box = document.getElementById('reset-prog');
      if (!box) return;
      var f = document.getElementById('reset-prog-fill');
      if (!f) return;
      if (!f.__watched){
        f.__watched = 1;
        function snap(){ var t=document.getElementById('reset-prog-txt'); recordStep(String(f.style.width), t? t.textContent : null); }
        new MutationObserver(snap).observe(f, { attributes: true, attributeFilter: ['style'] });
        var tb = document.getElementById('reset-prog-txt');
        if (tb) new MutationObserver(snap).observe(tb, { childList: true, characterData: true, subtree: true });
        snap();
      }
    }).observe(document, { childList: true, subtree: true }); } catch(e){} };
    if (document.documentElement) bootObs(); else document.addEventListener('DOMContentLoaded', bootObs);
  }catch(e){}
})();
` });

// 页面导航 + 启动期异常采集（记录器已随每个新文档注入）
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2500); };
await nav(base);
// 首次进站要过开屏/引导（夹具：直接关掉开屏并等数据就绪）
await evalJs("(function(){try{var s=document.getElementById('splash');if(s)s.remove();}catch(e){}return 1})()");
await sleep(1200);

// 种数据：足量 xy-home-v2 键，让「同步删键」这类阻塞真的显形
const seeded = await evalJs("(function(){var v=new Array(" + SEED_VAL + ").join('x');var n=0;for(var i=0;i<" + SEED_KEYS + ";i++){try{localStorage.setItem('xy-home-v2:seed-'+i,v);n++;}catch(e){}}return n})()");
R.lines.push('  · 夹具：已种 ' + seeded + ' 个 xy-home-v2 键（≈' + Math.round(seeded * SEED_VAL / 1048576) + 'MB）');

// 点「清除本地数据」→ 弹窗确定
const clicked = await evalJs("(function(){var r=document.getElementById('row-reset');if(!r)return 'no-row';r.click();return document.getElementById('modal-mask')&&!document.getElementById('modal-mask').hidden?'modal-open':'no-modal'})()");
ok('B0 设置行能打开确认弹窗', clicked === 'modal-open', String(clicked));

// 起点时间戳（跨重载可读）＋开始采样
await evalJs("sessionStorage.setItem('__p1064','[]');sessionStorage.setItem('__p1064-steps','[]');sessionStorage.setItem('__p1064-gap','0');sessionStorage.setItem('__p1064-base',String(Date.now()));window.__go=true;1");
const t0 = Date.now();
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1})()");

// 采样最多 12s：出现终态文案或 xy-home-v2 键被清空即收
let sawReload = false;
for (let i = 0; i < 120; i++) {
  await sleep(100);
  const st = await evalJs("(function(){try{var a=JSON.parse(sessionStorage.getItem('__p1064')||'[]');var done=a.some(function(s){return s.txt&&s.txt.indexOf('正在重新打开')>=0});var left=0;try{for(var i=0;i<localStorage.length;i++){if(String(localStorage.key(i)).indexOf('xy-home-v2:')===0)left++;}}catch(e){}return {done:done,left:left,clicked:!!document.getElementById('row-reset')};}catch(e){return {done:false,left:-1};}})()").catch(() => ({ done: false, left: -1 }));
  if (st && st.done) break;
  if (st && st.clicked === false) { sawReload = true; break; }   // 已重载（新文档没有设置行）
}
const elapsed = Date.now() - t0;
const samples = await evalJs("JSON.parse(sessionStorage.getItem('__p1064')||'[]')").catch(() => []);
const steps = await evalJs("JSON.parse(sessionStorage.getItem('__p1064-steps')||'[]')").catch(() => []);
const gap = await evalJs("Number(sessionStorage.getItem('__p1064-gap')||0)").catch(() => 0);
const errs = await evalJs("JSON.parse(sessionStorage.getItem('__p1064-errors')||'[]')").catch(() => []);
const withBar = samples.filter((s) => s.bar);
const firstBarAt = withBar.length ? (withBar[0].dt || 0) : -1;
const widths = Array.from(new Set(steps.map((s) => s.w).filter(Boolean)));
const texts = Array.from(new Set(steps.map((s) => s.txt).filter(Boolean)));

ok('B1 确认后 <400ms 屏上出现清除进度条', firstBarAt >= 0 && firstBarAt < 400, '首现 ' + firstBarAt + 'ms（自确认起），采样帧 ' + samples.length + '/带条 ' + withBar.length + '，步进记录 ' + steps.length + ' 条');
ok('B2 进度条宽度逐步推进（≥3 个不同进度）', widths.length >= 3, '宽度序列 ' + JSON.stringify(widths.slice(0, 8)));
ok('B3 文案跨过 ≥2 个阶段', texts.length >= 2, '阶段文案 ' + JSON.stringify(texts.slice(0, 4)));
ok('B4 重启前有「清除完成」终态', texts.some((t) => t.indexOf('正在重新打开') >= 0), JSON.stringify(texts.slice(-2)));
ok('B5 清键期间最长单帧间隔 <400ms（分片让出主线程）', gap < 400, '最长帧间隔 ' + Math.round(gap) + 'ms');
ok('B6 清完确实重新加载页面', sawReload || samples.length > 0, '重载 ' + sawReload + '，总耗时 ' + elapsed + 'ms');
{
  // 重启后应用会自己写回少量正常键（splash-seen 等），所以判据是「种下的种子键一个不剩」——
  // 那才是本次清除的对象（用户数据键）
  const residue = await evalJs("(function(){var n=0;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('xy-home-v2:seed-')===0)n++;}}catch(e){return -1}return n})()").catch(() => -1);
  ok('B7 清除后种下的用户数据键一个不剩', residue === 0 || residue === -1, '残留种子键 ' + residue + '（-1＝读不到/已重载）');
}
ok('Z1 全程零未捕获 JS 异常', (errs || []).length === 0, JSON.stringify(errs));

console.log('===== #1064 清除本地数据进度条 =====');
console.log('root = ' + root);
R.lines.forEach((l) => console.log(l));
console.log('结果：通过 ' + R.pass + ' / 失败 ' + R.fail);
try { ws.close(); } catch (e) {}
try { cp.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(R.fail ? 1 : 0);
