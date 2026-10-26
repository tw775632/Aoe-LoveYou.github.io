// #1304 回归电池：iPhone 15 / Safari 实报「所有功能选择和上传图片无反应」——本批两件可证的事
//   ① 文件选择取证环从内存搬进 localStorage（页面被回收上百次的设备上，证据必须在诊断单送达时仍在）
//   ② 「搬层到指尖下」这一腿不再把没验证的事记成已做到（激活前复核 + 不通过就继续走原有两腿 + 转交失败留痕）
// 验证＝node tools/verify-1304-pick-forensics.mjs（默认打本地仓根；SERVE_ROOT 指向仓外构建副本）
// 判别设计：C 段把「真被渲染」判据人为判假——绿侧必须记 fb:stuck 并**再补一次**对原 input 的激活，
// 基线侧（无条件记 fb:onscreen 后直接 return）在这一格必然转红。名字留着、逻辑改回去也拦得住。
import fs from 'fs';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright';

const ROOT = process.env.SERVE_ROOT || process.cwd();
console.log('被测根目录：' + ROOT);
const readArtifact = (rel) => {
  const p = path.join(ROOT, rel);
  try { return fs.existsSync(p) && !fs.statSync(p).isDirectory() ? fs.readFileSync(p, 'utf8') : ''; } catch (e) { return ''; }
};
// device.js 可能内联在 index.html，也可能外置成 js/device.js——按产物实际形态取
const deviceText = () => readArtifact('js/device.js') || readArtifact('index.html');

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(fp);
  const ct = ext === '.html' ? 'text/html;charset=utf-8' : ext === '.js' ? 'application/javascript' : ext === '.json' ? 'application/json' : 'text/css';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// ================= A. 产物锚（本批四件源文件的可证事实） =================
console.log('A. 产物锚');
const dev = deviceText();
const per = readArtifact('js/personalize.js') || dev;
const dbk = readArtifact('js/data-backup.js') || dev;
const idx = readArtifact('index.html');
ok(per.includes("if (p.pick && window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) {")
  && per.includes('try { window.mochiFilePickSurface(b, p.pick); } catch (eP) {}'),
  'A1 图标上传胶囊＝铺真·可命中 input 层，且命中那一下让路给原生默认动作（#1195a/#1195b）');
ok(per.includes("pick: { id: 'mochi-appicon-pick-surf', accept: 'image/*', onFiles: onIconFiles }"),
  'A2 这层与 mochiFilePick 共用同一份选后管线（两条激活腿产物不分叉，#1195c）');
ok(per.includes('colorInput.hidden = !opts.colorPicker;')
  && !per.includes('left:-9999px;top:0;width:40px;height:30px;opacity:0;pointer-events:none;z-index:-1'),
  'A3 取色行改成「原生控件本身可见可点」，旧的离屏＋合成 click 已不在产物里（#1195d/#1195x）');
ok(dev.includes('try { void ov.offsetWidth; } catch (e7) {}'),
  'A4 搬层写完几何后先强制排版，再交给调用方激活（#1304a）');
ok(dev.includes('fbOk = window.mochiFileInputRendered(fb) && document.elementFromPoint(tap.x, tap.y) === fb;')
  && dev.includes("fbOk ? 'fb:onscreen' : 'fb:stuck'"),
  'A5 激活前复核「这一层此刻真在指尖下」，不过则记 fb:stuck（#1304b）');
ok(dev.includes("window.mochiPickLogKey = function () { return 'xy-home-v2:__pick-log'; };")
  && dev.includes('localStorage.setItem(window.mochiPickLogKey(), JSON.stringify(arr))'),
  'A6 取证环落 localStorage 且写入接在记环那一步里（#1304c）');
ok(dev.includes("mochiPickLog('pick', 'fb:nosink')") && dev.includes("mochiPickLog((orig.id || 'pick'), 'fb:drop')"),
  'A7 两处静默分支改了留痕（没接收方／转交抛错，#1304d/#1304e）');
ok(dbk.includes("const PICK_LOG_KEY = 'xy-home-v2:__pick-log';")
  && (dbk.split('if (k === PICK_LOG_KEY) continue;').length - 1) >= 2,
  'A8 导出两个循环各跳过取证环＝本机取证不随备份文件外传（#1304f）');
ok(/此环已跨刷新\/回收保留/.test(dev), 'A9 诊断表空环文案改成「跨刷新/回收」口径（不再有「本页没点过」这种误导）');

// ================= 浏览器段 =================
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e && e.message)));
await page.addInitScript(() => {
  try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
  window.__clicks = [];
  const orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this && this.type === 'file') window.__clicks.push(this.id || '(noid)');
    try { return orig.apply(this, arguments); } catch (e) { window.__clicks.push((this.id || '(noid)') + '!threw'); }
  };
});
const goto = async () => {
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.splash-box *')].find(e => /进入|开始/.test(e.textContent || '') && e.children.length === 0);
    if (btn) btn.click();
  });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { document.querySelectorAll('.qa-mask,.tc-mask,.call-mask,.splash').forEach(e => { e.classList.add('hide'); e.remove(); }); document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true); document.body.classList.remove('scroll-lock'); });
};
await goto();
const ring = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('xy-home-v2:__pick-log') || '[]').map(x => x.e + '|' + x.s); } catch (e) { return ['ERR ' + e.message]; } });
const memRing = () => page.evaluate(() => (window.__mochiPickLog || []).map(x => x.e + '|' + x.s));

// ================= B. 取证环跨刷新/回收 =================
console.log('B. 取证环持久在 localStorage');
const b1 = await page.evaluate(() => {
  try { localStorage.removeItem('xy-home-v2:__pick-log'); } catch (e) {}
  if (window.mochiPickLog) window.mochiPickLog('seed-init', 'leg:fire');
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('xy-home-v2:__pick-log') || 'null'); } catch (e) { stored = 'PARSE-ERR'; }
  return { key: window.mochiPickLogKey ? window.mochiPickLogKey() : null, stored };
});
ok(b1.key === 'xy-home-v2:__pick-log', 'B1 键名是系统根键（__ 前缀，migrateLegacy 不吃它）', b1.key);
ok(Array.isArray(b1.stored) && b1.stored.some(x => x.e === 'seed-init'), 'B2 记一笔即落盘（不是只留在内存）', b1.stored);

const b3 = await page.evaluate(() => {
  for (let i = 0; i < 9; i++) window.mochiPickLog('bulk' + i, 'leg:fire');
  const stored = JSON.parse(localStorage.getItem('xy-home-v2:__pick-log') || '[]');
  return { n: stored.length, first: stored[0] && stored[0].e, last: stored[stored.length - 1] && stored[stored.length - 1].e, hasOldest: stored.some(x => x.e === 'bulk0') };
});
ok(b3.n === 6 && b3.first === 'bulk3' && b3.last === 'bulk8' && !b3.hasOldest, 'B3 环上限 6 条、丢最旧（诊断单体积不失控）', b3);

const b4 = await page.evaluate(() => {
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  let threw = null;
  try { window.mochiPickLog('quota-case', 'leg:fire'); } catch (e) { threw = String(e && e.message); }
  Storage.prototype.setItem = origSet;
  const mem = (window.__mochiPickLog || []).map(x => x.e);
  return { threw, still: mem.indexOf('quota-case') >= 0, n: mem.length };
});
ok(!b4.threw && b4.still, 'B4 配额写不进去时内存环照记、异常不外漏（取证不许反过来弄坏功能）', b4);

await page.evaluate(() => { window.mochiPickLog('across-reload', 'fb:files=1'); });
await goto();
const b5 = await page.evaluate(() => ({
  ls: (function () { try { return JSON.parse(localStorage.getItem('xy-home-v2:__pick-log') || '[]').map(x => x.e); } catch (e) { return []; } })(),
  mem: (window.__mochiPickLog || []).map(x => x.e),
}));
ok(b5.ls.indexOf('across-reload') >= 0, 'B5 重新加载（=页面被回收再重建）后磁盘上的环还在', b5.ls);
ok(b5.mem.indexOf('across-reload') >= 0, 'B6 冷启时内存环由 localStorage 播种＝诊断表当场能读到历史证据', b5.mem);

// ================= C. 搬层不再「假装成功」 =================
console.log('C. 搬层到指尖下：验证过才算成功');
const mk = await page.evaluate(() => {
  let i = document.getElementById('t1304-sr');
  if (!i) {
    i = document.createElement('input');
    i.type = 'file'; i.id = 't1304-sr';
    i.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
    document.body.appendChild(i);
  }
  return !!i;
});
ok(mk, 'C0 备好一个「sr-only 常驻 input」（＝真机上被内核静默拒绝的那种形态）');

// C1/C2 同一场景跑两遍：判据正常 / 判据人为判假。两遍前都把环清空（内存＋磁盘），
// 否则上一遍的 fb:onscreen 会留在环里，C4 那条「不再假装成功」就判不出来。
const runFire = (stubFalse) => page.evaluate((stub) => {
  window.__clicks = [];
  window.__mochiPickLog = [];
  try { localStorage.removeItem('xy-home-v2:__pick-log'); } catch (e) {}
  // 先只搬层、不激活：这一格读到的才是「内核要不要为它弹选择器」那一刻的事实
  const probe = (() => {
    const fb = window.mochiPickFallback(document.getElementById('t1304-sr'), { x: 150, y: 320 });
    if (!fb) return null;
    const r = fb.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), hit: document.elementFromPoint(150, 320) === fb, pe: getComputedStyle(fb).pointerEvents };
  })();
  const keep = window.mochiFileInputRendered;
  if (stub) window.mochiFileInputRendered = function () { return false; };
  window.__mochiLastTap = { x: 150, y: 320, t: Date.now() };
  const inp = document.getElementById('t1304-sr');
  const ret = window.mochiFilePickFire(inp, {});
  if (stub) window.mochiFileInputRendered = keep;
  return {
    ret,
    clicks: window.__clicks.slice(),
    log: (window.__mochiPickLog || []).map(x => x.e + '|' + x.s),
    probe,
  };
}, stubFalse);

const good = await runFire(false);
ok(good.log.indexOf('t1304-sr|fb:onscreen') >= 0, 'C1 层真在指尖下时记 fb:onscreen（口径没被改坏）', good.log);
ok(good.probe && good.probe.w >= 24 && good.probe.h >= 24 && good.probe.hit && good.probe.pe === 'auto',
  'C2 激活那一刻这一层有真实盒子、可命中、且命中点就是它（#1304a/b 的前提）', good.probe);

const stuck = await runFire(true);
ok(stuck.log.indexOf('t1304-sr|fb:stuck') >= 0, 'C3 「真被渲染」判假时必须记 fb:stuck（基线恒记 fb:onscreen＝红＝本批第②件的可证点）', stuck.log);
ok(stuck.log.indexOf('t1304-sr|fb:onscreen') < 0, 'C4 判假时不再出现「假装成功」的那条留痕', stuck.log);
ok(stuck.clicks.indexOf('t1304-sr') >= 0, 'C5 判假时不早退，仍对原 input 补一次激活（绝不比改前少试）', stuck.clicks);
const goodClicks = await page.evaluate(() => (window.__mochiPickLog || []).map(x => x.s).indexOf('leg:fire') >= 0);
ok(goodClicks, 'C6 程序化两腿的 leg:fire 留痕仍在（取证族既有 token 一个没丢）');

const nosink = await page.evaluate(() => {
  try { localStorage.removeItem('xy-home-v2:__pick-log'); } catch (e) {}
  const fb = window.mochiPickFallback(document.getElementById('t1304-sr'), { x: 150, y: 320 });
  window.__mochiPickFbTarget = null;
  const dt = new DataTransfer();
  dt.items.add(new File(['abc'], 'x.png', { type: 'image/png' }));
  try { fb.files = dt.files; } catch (e) { return { err: 'files-set ' + e.message }; }
  fb.dispatchEvent(new Event('change'));
  return { log: (window.__mochiPickLog || []).map(x => x.e + '|' + x.s) };
});
ok(nosink.log && nosink.log.indexOf('pick|fb:nosink') >= 0, 'C7 层收到文件却没有接收方时留痕 fb:nosink（基线裸 return＝查不到）', nosink);

const drop = await page.evaluate(() => {
  try { localStorage.removeItem('xy-home-v2:__pick-log'); } catch (e) {}
  const sink = document.createElement('input');
  sink.type = 'file'; sink.id = 't1304-sink';
  Object.defineProperty(sink, 'files', { get() { return null; }, set() { throw new Error('boom'); }, configurable: true });
  const fb = window.mochiPickFallback(sink, { x: 150, y: 320 });
  window.__mochiPickFbTarget = sink;
  const dt = new DataTransfer();
  dt.items.add(new File(['abc'], 'x.png', { type: 'image/png' }));
  try { fb.files = dt.files; } catch (e) { return { err: 'files-set ' + e.message }; }
  fb.dispatchEvent(new Event('change'));
  const t = document.getElementById('cc-toast');
  return {
    log: (window.__mochiPickLog || []).map(x => x.e + '|' + x.s),
    toast: t && t.classList.contains('show') ? t.textContent : '',
  };
});
ok(drop.log && drop.log.indexOf('t1304-sink|fb:drop') >= 0, 'C8 转交抛错时留痕 fb:drop（基线 catch {} 全静默＝这一格隐形）', drop);
ok(/没能转交/.test(drop.toast || ''), 'C9 转交失败当面对用户说一句真话（体感与「点了没反应」相同，不能只留给诊断）', drop.toast);

// ================= D. 邻接不回归 =================
console.log('D. 邻接不回归');
const adj = await page.evaluate(() => ({
  fns: ['mochiFilePick', 'mochiFilePickSurface', 'mochiFilePickSurfaceTap', 'mochiFilePickFire', 'mochiFilePickGuard', 'mochiModalPickOk', 'mochiFileInputRendered', 'mochiPickFallback', 'mochiPickLog'].filter(k => typeof window[k] === 'function'),
  importLog: typeof window.mochiImportLog === 'function',
}));
ok(adj.fns.length === 9, 'D1 文件选择九件套齐在（本批没拆任何一条腿）', adj.fns);
ok(adj.importLog, 'D2 #1272 导入回执环不受影响（同一口径的先例还在）');

const pill = await page.evaluate(async () => {
  const a = document.querySelector('.app-grid .app[data-app]');
  if (!a || !window.openIconMenu) return { err: 'no app/openIconMenu' };
  window.openIconMenu(a);
  await new Promise(r => setTimeout(r, 400));
  const mask = document.querySelector('.modal-mask:not([hidden])');
  const p = mask && [...mask.querySelectorAll('.pill')].find(x => /上传图片|更换图片/.test(x.textContent));
  const s = p && p.querySelector('input.mochi-pick-surface');
  const r = p ? p.getBoundingClientRect() : null;
  return { hasPill: !!p, hasSurface: !!s, hit: r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === s : false };
});
ok(!pill.err && pill.hasPill && pill.hasSurface, 'D3 图标菜单「上传/更换图片」胶囊带着真·可点层（#1195 那条腿在场）', pill);
ok(pill.hit === true, 'D4 胶囊中心命中的是那层原生 input（手指按到＝浏览器自己的默认动作）', pill);
await page.evaluate(() => { document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true); document.body.classList.remove('scroll-lock'); });

ok(pageErrs.length === 0, 'D5 全程零页面 JS 异常', pageErrs.slice(0, 5));

console.log('\n==== #1304 结果：通过 ' + pass + ' / 失败 ' + fail + ' ====');
await browser.close();
srv.close();
process.exit(fail ? 1 : 0);
