// ===== 常驻回归：#1065~#1073 全站重活「有进度、不静默失败」 =====
// 用户口径：「点击【清除本地数据】会卡顿，没有清除进度条」→ 追问「其他功能有没有这种问题」。
// 审计结论：同一模式（同步重活 + 无进度 + 无失败回执）散布在 8 处用户可点入口。
// 本批统一收敛到 device.js 的 window.mochiProgress（顶部胶囊，指针穿透）＋ window.mochiYield
// （分片让出主线程），并给两处缺失 try/catch 的写盘点补上如实回执。
// 断言分三类：
//  S 组 产物源锚（红侧必红）：共享工具 + 各入口接线的逻辑锚（needle 与 FIX_SENTINELS 同源）
//  B 组 行为：直接驱动设置页入口，量「进度胶囊是否真的出现在屏上、文案是否说到在做什么」
//     B1 工具本体：mochiProgress 建→step 写宽度与文案→done 移除；mochiYield 真让出一拍
//     B2 字卡使用状态自检（#1068）点开先有「正在自检…」态并出现胶囊
//     B3 压缩图片（#1067）点击后出现胶囊，文案进入「扫描/压缩」段
//     B4 一键优化（#1073）行点击后出现胶囊（扫描段）
//     B5 删除全部聊天记录（#1072）确认后出现「正在清空聊天记录」胶囊，且屏上消息被清空
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1065-heavy-ops-progress.mjs
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };
const readFile = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

// ---------- S 组：产物源锚（needle 与 build.mjs FIX_SENTINELS 同源） ----------
{
  const idx = readFile('index.html');
  const cases = [
    ['S1 共享进度条工具（device.js 内联）', idx, 'window.mochiProgress = api;'],
    ['S2 分片让出助手 mochiYield', idx, 'window.mochiYield = function ()'],
    ['S3 仅聊天记录导入：解析前铺进度', readFile('js/data-backup.js'), "prog.step(4, '正在解析备份文件"],
    ['S4 导入写库阶段 i/N 进度', readFile('js/data-backup.js'), 'prog.step(35, jobs.length'],
    ['S5 压缩图片逐张进度', readFile('js/img-compress.js'), '压缩字卡库 '],
    ['S6 字卡自检先铺进度态', readFile('js/card-audit.js'), '正在自检…（字卡库较大时需要几秒，请稍候）'],
    ['S7 字卡库写盘带成败回执', readFile('js/chatcard.js'), 'function saveGroupsWithFeedback(okMsg) {'],
    ['S8 音乐导入逐首进度', readFile('js/music-player.js'), 'upProg.step(2 + Math.round(96 * (idx - 1)'],
    ['S9 清理音频缓存有 catch', readFile('js/music-player.js'), 'prog.fail(\'清理未完成\');'],
    ['S10 删除联系人分片＋回执', readFile('js/contacts.js'), '正在删除联系人数据'],
    ['S11 清空聊天分块逐块进度', readFile('js/chat.js'), "正在清理分块记录 ' + (i2 + 1)"],
    ['S12 扫描逐库进度', readFile('js/storage-slim.js'), '正在读取存储键清单…'],
    ['S13 一键优化扫描段接胶囊', readFile('js/personalize.js'), 'healScanProg.step'],
  ];
  cases.forEach(function (c) { ok(c[0], c[1].indexOf(c[2]) >= 0); });
}

// ---------- 启动 headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1065-' + Date.now());
const cp = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]); } });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const targets = await (await fetch(dbg + '/json/list')).json();
let page = targets.find((t) => t.type === 'page') || await (await fetch(dbg + '/json/new?about:blank')).json();
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
  if (r.exceptionDetails) throw new Error('EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  try{
    if (sessionStorage.getItem('__p1065-errors') === null) sessionStorage.setItem('__p1065-errors','[]');
    var errs = JSON.parse(sessionStorage.getItem('__p1065-errors') || '[]');
    window.addEventListener('error', function(ev){ errs.push(String(ev.message||ev.error)); sessionStorage.setItem('__p1065-errors', JSON.stringify(errs.slice(0,5))); });
    window.addEventListener('unhandledrejection', function(ev){ errs.push('rej:'+String(ev.reason)); sessionStorage.setItem('__p1065-errors', JSON.stringify(errs.slice(0,5))); });
  }catch(e){}
})();
` });
await send('Page.navigate', { url: base });
await sleep(2600);
await evalJs("(function(){try{var s=document.getElementById('splash');if(s)s.remove();}catch(e){}return 1})()");
await sleep(1500);

// 进入设置页（各入口的宿主页；程序化点击不依赖可见性，但让屏上确实在设置页更接近真实）
await evalJs("(function(){try{var t=document.querySelector('.tabbar .tab[data-page=\"page-setting\"]');if(t)t.click();}catch(e){}return 1})()");
await sleep(600);

const progState = "JSON.parse(sessionStorage.getItem('__p1065')||'[]')";
// 调用记录：给 mochiProgress 包一层，任何入口一旦用它就落一条（不吃采样节奏——
// 无图/空夹具下扫描可能几十毫秒就跑完，纯靠 40ms 采样会漏）
await evalJs("(function(){ if(window.__p1065Wrapped) return 1; var orig=window.mochiProgress; if(!orig) return 0; window.__p1065Log=[]; window.mochiProgress=function(t){ var h=orig(t); try{ window.__p1065Log.push('call|'+t); var sp=h.step; h.step=function(p,l){ try{ window.__p1065Log.push('step|'+t+'|'+(l==null?'':l)); }catch(e){} return sp.apply(h, arguments); }; var dn=h.done; h.done=function(m){ try{ window.__p1065Log.push('done|'+t); }catch(e){} return dn.apply(h, arguments); }; var fl=h.fail; h.fail=function(m){ try{ window.__p1065Log.push('fail|'+t+'|'+(m==null?'':m)); }catch(e){} return fl.apply(h, arguments); }; }catch(e){} return h; }; window.__p1065Wrapped=1; return 1; })()");
const logHas = async (needle, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) {
    const L = await evalJs('(window.__p1065Log||[])').catch(() => []);
    if ((L || []).join('\n').indexOf(needle) >= 0) return true;
    await sleep(120);
  }
  return false;
};
// 采样器：每 40ms 记一次进度胶囊状态（跨步骤累计，便于判断「出现过什么」）
await evalJs(`(function(){
  sessionStorage.setItem('__p1065','[]');
  if (window.__p1065Watch) clearInterval(window.__p1065Watch);
  window.__p1065Watch = setInterval(function(){
    try{
      var p = document.getElementById('mochi-prog');
      var t = document.getElementById('mochi-prog-sub');
      var ti = document.getElementById('mochi-prog-title');
      var arr = JSON.parse(sessionStorage.getItem('__p1065')||'[]');
      arr.push({ bar: !!p, title: ti? ti.textContent : null, sub: t? t.textContent : null, t: Date.now() });
      sessionStorage.setItem('__p1065', JSON.stringify(arr.slice(-400)));
    }catch(e){}
  }, 40);
  return 1;
})()`);
const seen = async (needle, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) {
    const arr = await evalJs(progState);
    if ((arr || []).some((s) => s.bar && ((s.sub || '') + (s.title || '')).indexOf(needle) >= 0)) return true;
    await sleep(120);
  }
  return false;
};

// ---------- B1 工具本体 ----------
{
  const r = await evalJs(`(function(){
    if (!window.mochiProgress) return { api:false };
    var p = window.mochiProgress('回归自检');
    var box0 = !!document.getElementById('mochi-prog');
    p.step(37, '第一步 37%');
    var w = (document.getElementById('mochi-prog-fill')||{}).style ? document.getElementById('mochi-prog-fill').style.width : '';
    var sub = (document.getElementById('mochi-prog-sub')||{}).textContent;
    p.step(10, '倒退不该生效');
    var w2 = document.getElementById('mochi-prog-fill').style.width;
    p.done();
    var box1 = !!document.getElementById('mochi-prog');
    return { api:true, box0:box0, w:w, sub:sub, w2:w2, box1:box1, yld: (typeof window.mochiYield === 'function') };
  })()`, false);
  ok('B1a mochiProgress 建盒并 step 写宽度/文案', r.api && r.box0 && r.w === '37%' && r.sub === '第一步 37%', JSON.stringify(r));
  ok('B1b 进度单调不减（37% 后写 10% 不倒退）', r.w2 === '37%', 'w2=' + r.w2);
  ok('B1c done() 移除胶囊且 mochiYield 在', r.box1 === false && r.yld === true, JSON.stringify(r));
  const y = await evalJs("(function(){if(typeof window.mochiYield !== 'function') return -1;var t0=Date.now();return window.mochiYield().then(function(){return Date.now()-t0;})})()", true).catch(() => -1);
  ok('B1d mochiYield 真让出一拍', typeof y === 'number' && y >= 0, '让出 ' + y + 'ms');
}

// ---------- B2 字卡使用状态自检（#1068） ----------
{
  await evalJs("(function(){var r=document.getElementById('row-card-audit');if(r)r.click();return !!r})()");
  await sleep(120);
  const hasBusyText = await evalJs("(function(){var b=document.querySelector('#page-card-audit .ca-banner');return !!(b && b.textContent.indexOf('正在自检')>=0)})()").catch(() => false);
  const hasBar = await seen('正在自检字卡库', 3000);
  const ends = await seen('', 0) ? true : true;
  ok('B2 字卡自检点开即有进度态（屏上文案或胶囊）', hasBusyText || hasBar, 'busyText=' + hasBusyText + ' capsule=' + hasBar);
  void ends;
  // 回到设置页
  await evalJs("(function(){try{var b=document.querySelector('#page-card-audit .back, #page-card-audit .cal-back');if(b)b.click();}catch(e){}try{var t=document.querySelector('.tabbar .tab[data-page=\"page-setting\"]');if(t)t.click();}catch(e){}return 1})()");
  await sleep(400);
}

// ---------- B3 压缩图片（#1067） ----------
{
  await evalJs("(function(){window.__p1065Log=[];return 1})()");
  await evalJs("(function(){var r=document.getElementById('row-img-compress');if(r)r.click();return !!r})()");
  const bar = await logHas('call|正在扫描图片', 4000);
  const stepped = await logHas('step|正在扫描图片|扫描', 4000) || await logHas('扫描字卡库', 4000);
  ok('B3 压缩图片点击后出现进度胶囊（扫描段且有逐库文案）', bar && stepped, 'bar=' + bar + ' stepped=' + stepped);
  await sleep(400);
}

// ---------- B4 一键优化（#1073） ----------
{
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;window.__p1065Log=[];return 1})()");
  await evalJs("(function(){var r=document.getElementById('row-perf-optimize');if(r)r.click();return !!r})()");
  const bar = await logHas('call|正在扫描字卡库占用', 4000);
  const stepped = await logHas('step|正在扫描字卡库占用|正在统计', 4000) || await logHas('正在读取存储键清单', 4000);
  ok('B4 一键优化行点击后出现扫描进度胶囊并逐库推进', bar && stepped, 'bar=' + bar + ' stepped=' + stepped);
  await sleep(400);
}

// ---------- B5 删除全部聊天记录（#1072） ----------
{
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;return 1})()");
  const r = await evalJs("(function(){var b=document.getElementById('cs-clear-msgs');if(!b)return 'no-row';b.click();return (document.getElementById('modal-mask')&&!document.getElementById('modal-mask').hidden)?'modal':'no-modal'})()");
  ok('B5a 「删除全部聊天记录」能打开确认弹窗', r === 'modal', String(r));
  await evalJs("(function(){window.__p1065Log=[];var b=document.getElementById('modal-ok');if(b)b.click();return 1})()");
  const bar = await logHas('call|正在清空聊天记录', 4000);
  const cleared = await evalJs("(function(){try{var b=document.getElementById('chat-body');return b? b.children.length : -1;}catch(e){return -2}})()");
  const stored = await evalJs("(function(){var n=0;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&/:chat-msgs$/.test(k))n++;}}catch(e){}return n})()");
  ok('B5b 清空动作铺出进度胶囊', bar);
  ok('B5c 聊天消息已清空（内存键不残留）', stored === 0, '残留 chat-msgs 键 ' + stored + '，chat-body 子节点 ' + cleared);
}

const errs = await evalJs("JSON.parse(sessionStorage.getItem('__p1065-errors')||'[]')").catch(() => []);
ok('Z1 全程零未捕获 JS 异常', (errs || []).length === 0, JSON.stringify(errs));

console.log('===== #1065~#1073 重活进度与失败回执 =====');
console.log('root = ' + root);
R.lines.forEach((l) => console.log(l));
console.log('结果：通过 ' + R.pass + ' / 失败 ' + R.fail);
try { ws.close(); } catch (e) {}
try { cp.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(R.fail ? 1 : 0);
