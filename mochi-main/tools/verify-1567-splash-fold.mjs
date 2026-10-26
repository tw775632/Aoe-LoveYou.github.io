// verify-1567-splash-fold.mjs — #1567 开屏【折叠公告详情】偏好按设备记住＋折叠视图只留三张卡与品牌卡（常驻）
// 判据面：
//   A 静态锚（构建产物）：折叠收起规则（css）／回填＋写入（js/clock.js）／根键登记 migrateLegacy EXCLUDE（js/contacts.js）。
//   B 行为面（无头 Chromium 同一 profile 连续冷启真跑开屏）：
//     B1 首开＝全文展开、折叠按钮未勾选时隐藏；
//     B2 勾选年龄后按钮出现，点折叠写偏好 '1' 且只留「防倒卖/使用前提/免责声明」三卡（品牌卡整体收起，#1574）；
//     B3 第二次冷启（restore-done 后 migrateLegacy 已真跑）＝根键未被迁进 default、开屏直接是折叠态；
//     B4 第三次冷启＝偏好仍在（「不用重复点」成立）；
//     B5 点展开写 '0' → 重开＝全文展开（正文一字未删地回来）；
//     B6 声明版本失配（age-confirmed 换旧版本）＝不回填、全文展开（不让折叠藏掉要重新确认的内容）。
// 用法：node tools/verify-1567-splash-fold.mjs（MOCHI_SERVE_ROOT= 指定仓外副本根）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const chromePath = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(2); }
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

console.log('\n== A 静态锚 ==');
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const idx = read('index.html'), clk = read('js/clock.js'), ct = read('js/contacts.js');
ok(idx.includes('.splash-box.splash-folded .splash-cardlock { display:none; }'), 'A1 折叠后收起其余必读卡的规则在位（顶卡/精简条/备份/不互通/停更/字卡锁）');
ok(idx.includes('.splash-box.splash-folded .splash-brandcard .splash-source { display:none; }'), 'A6 #1570 品牌卡子块（设计与开发/许可长块/原作部署/原版说明）折叠态全收（作者两次圈卡反馈；删＝折叠视图又露长块）');
ok(idx.includes('.splash-box.splash-folded .splash-brandcard { display:none; }'), 'A6b #1574 品牌卡整体折叠态收起（作者直派「一并收起」；删＝折叠视图又露品牌卡头部 logo＋标题＋署名）');
ok(idx.includes('.splash-box.splash-folded .splash-notice { display:none; }'), 'A2 折叠仍收公告章节（旧口径未被拆掉）');
ok(clk.includes("folded = localStorage.getItem(FOLD_KEY) === '1'"), 'A3 偏好回填逻辑在位');
ok(clk.includes("localStorage.setItem(FOLD_KEY, folded ? '1' : '0')"), 'A4 点折叠/展开写入偏好在位');
ok(ct.includes("'splash-folded', 'age-confirmed'"), 'A5 根键登记 migrateLegacy EXCLUDE（漏＝冷启一次被迁进 default 并删根键）');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1567-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page');
  if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {}
  await sleep(150); }
if (!ws) { try { server.close(); } catch (e) {} try { chrome.kill(); } catch (e) {} console.error('无法连接无头浏览器'); process.exit(2); }
const cdp = (method, params = {}) => { const i = ++id; return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; };
const J = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

const snap = `(function(){
  var d=function(s){var e=document.querySelector(s);return e?getComputedStyle(e).display:null;};
  var box=document.getElementById('splash-box'), tg=document.getElementById('splash-fold-toggle');
  return JSON.stringify({ root: localStorage.getItem('xy-home-v2:splash-folded'), def: localStorage.getItem('xy-home-v2:default:splash-folded'),
    mig: !!window.__contactsMigrated, folded: box?box.classList.contains('splash-folded'):null, label: tg?tg.textContent:null, tgHidden: tg?!!tg.hidden:null,
    bigwarn: d('.splash-bigwarn'), abouttip: d('.splash-abouttip'), backup: d('.splash-backup'), storesplit: d('.splash-storesplit'),
    stopupdate: d('.splash-stopupdate'), cardlock: d('.splash-cardlock'), notice: d('#splash-notice'), lic: d('.splash-license'),
    keep1: d('.splash-mustread .splash-alert[data-anti-scam="1"]'), keep2: d('.splash-mustread .splash-alert[data-anti-scam="w"]'),
    keep3: d('#splash-disclaimer'), brand: d('.splash-brandcard'),
    srcs: Array.prototype.map.call(document.querySelectorAll('.splash-brandcard .splash-source'), function (e) { return getComputedStyle(e).display; }) });
})()`;
// 冷启：等 restore-done 后 migrateLegacy 真跑完（短等会漏掉整条迁移路径＝假绿）
const load = async (ms) => { await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(ms); };

console.log('\n== B 行为面（同一 profile 连续冷启）==');
await load(3000);
let s = J(await ev(snap));
ok(s.folded === false && s.tgHidden === true && s.root === null && s.bigwarn !== 'none' && s.notice !== 'none' && s.lic !== 'none' && s.srcs.length === 4 && s.srcs.every(function (x) { return x !== 'none'; }), 'B1 首开＝全文展开、未勾选年龄时折叠按钮隐藏（品牌卡四个子块展开态均可见）', JSON.stringify(s).slice(0, 220));

await ev(`document.getElementById('splash-age-check').click()`);
await sleep(400);
s = J(await ev(snap));
ok(s.tgHidden === false && s.label === '折叠公告详情' && s.folded === false, 'B2a 勾选年龄后按钮出现、文案＝折叠公告详情', JSON.stringify({ tgHidden: s.tgHidden, label: s.label }));
await ev(`document.getElementById('splash-fold-toggle').click()`);
await sleep(400);
s = J(await ev(snap));
ok(s.root === '1' && s.folded === true && s.label === '展开公告详情' &&
  s.bigwarn === 'none' && s.abouttip === 'none' && s.backup === 'none' && s.storesplit === 'none' && s.stopupdate === 'none' &&
  s.cardlock === 'none' && s.notice === 'none' && s.lic === 'none' && s.srcs.length === 4 && s.srcs.every(function (x) { return x === 'none'; }) &&
  s.keep1 !== 'none' && s.keep2 !== 'none' && s.keep3 !== 'none' && s.brand === 'none',
  'B2b 点折叠＝写偏好 1、只留「防倒卖/使用前提/免责声明」三卡（品牌卡整体同批收起，#1574）', JSON.stringify(s).slice(0, 260));

await load(9000);
s = J(await ev(snap));
ok(s.root === '1' && s.def === null && s.mig === true && s.folded === true && s.notice === 'none',
  'B3 第二次冷启（migrateLegacy 已跑）根键未被迁走、直接是折叠态', JSON.stringify({ root: s.root, def: s.def, mig: s.mig, folded: s.folded }));

await load(9000);
s = J(await ev(snap));
ok(s.root === '1' && s.def === null && s.folded === true && s.notice === 'none', 'B4 第三次冷启偏好仍在（不用重复点折叠）', JSON.stringify({ root: s.root, folded: s.folded }));

await ev(`document.getElementById('splash-fold-toggle').click()`);
await sleep(300);
s = J(await ev(snap));
ok(s.root === '0' && s.folded === false && s.bigwarn !== 'none' && s.notice !== 'none', 'B5a 点展开＝写偏好 0 且全文当场回来', JSON.stringify({ root: s.root, folded: s.folded }));
await load(9000);
s = J(await ev(snap));
ok(s.folded === false && s.bigwarn !== 'none' && s.notice !== 'none', 'B5b 重开＝保持展开态（双向都记住）', JSON.stringify({ root: s.root, folded: s.folded }));

await ev(`localStorage.setItem('xy-home-v2:splash-folded','1');localStorage.setItem('xy-home-v2:age-confirmed',JSON.stringify({t:Date.now(),v:'2000-01-01'}))`);
await load(9000);
s = J(await ev(snap));
ok(s.folded === false && s.notice !== 'none' && s.tgHidden === true, 'B6 声明版本失配＝不回填折叠、全文展开（要重新确认时不被藏着）', JSON.stringify({ root: s.root, folded: s.folded, tgHidden: s.tgHidden }));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
try { ws.close(); } catch (e) {} try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
