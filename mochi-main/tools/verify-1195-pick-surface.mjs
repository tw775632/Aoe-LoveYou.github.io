// #1195 回归电池：iOS 27 Safari 上「桌面图标无法上传图片 / 取色器无法自定义」＋切后台大键内存释放。
// 验证＝node tools/verify-1195-pick-surface.mjs（默认打本地仓根；SERVE_ROOT 可指向仓外构建副本）
//
// 判别设计：每条断言都钉在「原生控件是不是真的能被手指按到」这个**行为**上，
// 不钉函数名——名字留着、逻辑改回「离屏 + 合成 click」时，本电池必须转红。
import fs from 'fs';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright';

const ROOT = process.env.SERVE_ROOT || process.cwd();
console.log('被测根目录：' + ROOT);
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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e && e.message)));
await page.addInitScript(() => {
  try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
  window.__pickCalls = [];
  const orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this && this.type === 'file') window.__pickCalls.push(this.id);
    try { return orig.apply(this, arguments); } catch (e) { window.__pickCalls.push(this.id + '!threw'); }
  };
  window.__spCalls = [];
  try {
    const sp = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () { if (this.type === 'color') window.__spCalls.push('color'); return sp.apply(this, arguments); };
  } catch (e) {}
});
let fcChooser = null;
page.on('filechooser', fc => { fcChooser = fc; });

await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  const b = document.querySelector('.splash-box'); if (b) b.scrollTop = b.scrollHeight;
  const btn = [...document.querySelectorAll('.splash-box *')].find(e => /进入|开始/.test(e.textContent || '') && e.children.length === 0);
  if (btn) btn.click();
});
await page.waitForTimeout(2500);
await page.evaluate(() => { document.querySelectorAll('.qa-mask,.tc-mask,.call-mask,.splash').forEach(e => { e.classList.add('hide'); e.remove(); }); document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true); document.body.classList.remove('scroll-lock'); });

let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// ================= A. 桌面图标上传 =================
console.log('A. 桌面图标「上传图片」＝手指按在原生 file input 上');
await page.evaluate(() => { const a = document.querySelector('.app-grid .app[data-app]'); window.openIconMenu(a); });
await page.waitForTimeout(500);
const surf = await page.evaluate(() => {
  const mask = document.querySelector('.modal-mask:not([hidden])');
  const pill = mask && [...mask.querySelectorAll('.pill')].find(p => /上传图片|更换图片/.test(p.textContent));
  if (!pill) return { err: 'no pill' };
  const s = pill.querySelector('input.mochi-pick-surface');
  const pr = pill.getBoundingClientRect();
  const sr = s ? s.getBoundingClientRect() : null;
  const hit = document.elementFromPoint(pr.x + pr.width / 2, pr.y + pr.height / 2);
  return { hasSurface: !!s, accept: s ? s.accept : null, pillRect: { x: pr.x, y: pr.y, w: pr.width, h: pr.height }, sr: sr ? { x: sr.x, y: sr.y, w: sr.width, h: sr.height } : null, hitIsSurface: hit === s };
});
ok(!surf.err, 'A1 图标菜单里有「上传/更换图片」胶囊', surf.err);
ok(surf.hasSurface, 'A2 胶囊上铺了真·可点 file input 层（#1195b）', surf);
ok(surf.accept === 'image/*', 'A3 这层 accept=image/*', surf.accept);
ok(surf.hitIsSurface, 'A4 胶囊中心命中的是这层原生 input（不是胶囊按钮本身）', surf);
ok(surf.sr && Math.abs(surf.sr.x - surf.pillRect.x) < 2 && Math.abs(surf.sr.y - surf.pillRect.y) < 2
  && surf.sr.w >= surf.pillRect.w - 2 && surf.sr.h >= surf.pillRect.h - 2,
  'A5 这层铺满整个胶囊（手指随便点哪都落在原生控件上）', { sr: surf.sr, pill: surf.pillRect });

if (surf.pillRect) {
  await page.mouse.click(surf.pillRect.x + surf.pillRect.w / 2, surf.pillRect.y + surf.pillRect.h / 2);
  await page.waitForTimeout(700);
}
ok(!!fcChooser, 'A6 物理点按胶囊直接弹出文件选择器（浏览器原生默认动作）');
const synth = await page.evaluate(() => window.__pickCalls);
ok(synth.length === 0, 'A7 未发生任何程序化补腿（否则同一次操作会弹两次选择器）', synth);

if (fcChooser) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await fcChooser.setFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(2500);
}
const iconRes = await page.evaluate(() => {
  const app = document.querySelector('.app-grid .app[data-app]');
  const img = app ? app.querySelector('.app-ico img') : null;
  const k = app ? app.dataset.app : null;
  return { hasImg: !!img, srcLen: img ? (img.src || '').length : 0, storedLen: (k && localStorage.getItem('xy-home-v2:default:app-icon-' + k) || '').length };
});
ok(iconRes.hasImg && iconRes.srcLen > 100, 'A8 选完图图标真的换成了自定义图片', iconRes);
ok(iconRes.storedLen > 100 && iconRes.storedLen === iconRes.srcLen, 'A9 自定义图片已落盘（刷新后还在）', iconRes);

// ================= B. 取色器 =================
console.log('B. 取色器＝原生 input[type=color] 本身可见可按');
await page.evaluate(() => { document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true); document.body.classList.remove('scroll-lock'); });
await page.evaluate(() => { const r = document.getElementById('row-app-name-color'); if (r) r.click(); });
await page.waitForTimeout(600);
const cv = await page.evaluate(() => {
  const ci = document.getElementById('modal-color');
  const r = ci.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { hidden: ci.hidden, visible: !!ci.offsetParent, w: Math.round(r.width), h: Math.round(r.height), onScreen: r.y > 0 && r.y < window.innerHeight, hitIsItself: hit === ci, title: ci.title };
});
ok(!cv.hidden && cv.visible, 'B1 取色弹窗里原生色块是可见的（不是 hidden）', cv);
ok(cv.w > 100 && cv.h >= 30, 'B2 色块有真实可点面积（≥100×30）', cv);
ok(cv.onScreen, 'B3 色块在弹窗可视区内（不用先滚动才够得到）', cv);
ok(cv.hitIsItself, 'B4 色块中心命中它自己（手指直按＝原生默认动作）', cv);

await page.evaluate(() => { const c = document.getElementById('modal-custom'); if (c) c.click(); });
await page.waitForTimeout(300);
const sp = await page.evaluate(() => ({ spCalls: window.__spCalls.slice(), stillVisible: !!document.getElementById('modal-color').offsetParent }));
ok(sp.spCalls.indexOf('color') >= 0, 'B5 按钮优先走 showPicker()（iOS 16.4+ 唯一能弹离屏取色器的 API）', sp);
ok(sp.stillVisible, 'B6 按钮点完色块仍留在原地（失败时用户手上仍有可按的入口）', sp);

const applied = await page.evaluate(() => {
  const ci = document.getElementById('modal-color');
  ci.value = '#123456';
  ci.dispatchEvent(new Event('change', { bubbles: true }));
  const mask = document.querySelector('.modal-mask:not([hidden])');
  const okBtn = mask && mask.querySelector('#modal-ok');
  if (okBtn) okBtn.click();
  return { stored: localStorage.getItem('xy-home-v2:default:app-name-color'), style: (document.getElementById('app-name-color-style') || {}).textContent || '', val: (document.getElementById('app-name-color-val') || {}).textContent };
});
ok(applied.stored === '#123456', 'B7 直按色块选完的颜色真的落库', applied);
ok(/#123456/.test(applied.style), 'B8 颜色注入了图标名称样式（桌面立刻生效）', applied.style);

const other = await page.evaluate(() => {
  document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true);
  window.openModal('普通确认', '', () => {}, {});
  const ci = document.getElementById('modal-color');
  return { hidden: ci.hidden, visible: !!ci.offsetParent };
});
ok(other.hidden && !other.visible, 'B9 非取色弹窗不残留这条色块（零视觉污染）', other);
await page.evaluate(() => { document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true); });

// ================= C. 切后台大键内存释放 =================
console.log('C. 切后台释放大键内存副本（对着 69 次回收 / 45.7MB 常驻）');
const memo = await page.evaluate(async () => {
  if (!window.idbMemoReleaseBig) return { err: 'no idbMemoReleaseBig' };
  window.idbMemoSet('t-big-a', 'x'.repeat(400 * 1024));
  window.idbMemoSet('t-big-b', 'y'.repeat(300 * 1024));
  window.idbMemoSet('t-small', 'z'.repeat(50));
  const before = window.idbMemoStats(10);
  const dropped = window.idbMemoReleaseBig();
  const after = window.idbMemoStats(10);
  return { dropped, beforeBytes: before.bytes, afterBytes: after.bytes, keptBig: window.idbGetCached('t-big-a') !== undefined, keptSmall: window.idbGetCached('t-small') !== undefined };
});
ok(!memo.err, 'C1 通用释放口存在（#1195e）', memo.err);
ok(memo.dropped === 2, 'C2 两枚大键被放掉、小键保留（判据＝体积，不是点名）', memo);
ok(memo.keptBig === false && memo.keptSmall === true, 'C3 只丢大键，小键照常驻留', memo);
ok(memo.afterBytes < memo.beforeBytes, 'C4 驻留体积实测下降', memo);
const bgHook = await page.evaluate(() => ({ hasRelease: typeof window.idbMemoReleaseBig === 'function' }));
ok(bgHook.hasRelease, 'C5 释放口挂在切后台事件链上（idb.js 内部统一挂，不占各模块监听器）', bgHook);

// ================= D. 邻接不回归 =================
console.log('D. 邻接不回归');
const adjacent = await page.evaluate(() => {
  const out = {};
  out.filePickExists = typeof window.mochiFilePick === 'function';
  out.surfaceExists = typeof window.mochiFilePickSurface === 'function';
  out.surfaceTapExists = typeof window.mochiFilePickSurfaceTap === 'function';
  document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true);
  const r = document.getElementById('row-app-name-color');
  r.click();
  const mask = document.querySelector('.modal-mask:not([hidden])');
  out.swatchCount = mask ? mask.querySelectorAll('#modal-swatches .sw').length : 0;
  if (mask) { const sws = mask.querySelectorAll('#modal-swatches .sw'); const s = sws[7]; if (s) s.click(); }
  const okBtn = mask && mask.querySelector('#modal-ok');
  if (okBtn) okBtn.click();
  out.swatchStored = localStorage.getItem('xy-home-v2:default:app-name-color');
  out.swatchStyle = (document.getElementById('app-name-color-style') || {}).textContent || '';
  document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true);
  return out;
});
ok(adjacent.filePickExists && adjacent.surfaceExists && adjacent.surfaceTapExists, 'D1 统一文件选择入口三件套未被改动波及', adjacent);
ok(adjacent.swatchCount === 16, 'D2 色板 16 格照常渲染', adjacent);
ok(adjacent.swatchStored === '#e05555' && /#e05555/.test(adjacent.swatchStyle), 'D3 点色板的老路径仍能落库生效', adjacent);
ok(pageErrs.length === 0, 'D4 全程零页面 JS 异常', pageErrs.slice(0, 5));

console.log('\n==== #1195 结果：通过 ' + pass + ' / 失败 ' + fail + ' ====');
await browser.close();
srv.close();
process.exit(fail ? 1 : 0);
