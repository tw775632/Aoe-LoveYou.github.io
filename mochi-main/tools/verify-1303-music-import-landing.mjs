// ===== 常驻回归脚本 #1303：本地音乐导入「发起≠成功」＝写侧不看回执、失败不贴徽标、链路不留证 =====
// 实报（iPhone 12 Pro Max + Safari，附件诊断单）：「导音乐导不进去」，用户明说其他设备型号也有出现、
// 要求不要覆盖式修补。诊断单铁证：IndexedDB 里躺着 10 个 default:music-file:* 键共 112.4MB（音频确实
// 写进去过），而「数据导入回执（旧→新）」=（无）——音频这一环一个字都不留；本页被系统回收过 23 次。
// 三处病灶（零机型／零 UA 分支＝判据只取「这一笔写落没落定」「库里到底有没有这个键」两个内核无关事实）：
//  ① idb.js idbSet 的体积估时只认字符串与数组，Blob/File 一律估成 0 → 21MB 音频整包写与 200B 设置键
//     共用 4s 判定窗（同一条值以字符串形态写可拿 30s）＝把成功判成失败的第一环（同族 #950/#434/#226/#1227）。
//  ② music-player.js 的导入阶梯把「没等到回执」当「库里没有」，据此把整段音频二次编码成 ~28MB dataURL
//     重存、再落 localStorage 撞配额；storePayload 是 fire-and-forget、返回值没人看，完成提示一律按
//     「发起过几首」报「已上传 N 首音乐」＝#1210 同款假成功，用户只能反复重传。
//  ③ 载荷在 next() 与 storePayload() 各造一份 Blob（同一文件两份全量拷贝，写链闭包还拽着原始
//     ArrayBuffer）；旧 toDataUrl 把「已经是 dataURL 的字符串」再包一层 Blob 重读＝存进二次编码的坏值。
// 判据口径（判别器＝同 tip 纯 HEAD 副本红侧）：
//   S0 产物锚 7 条（#1303a~g）
//   B1 真链路成功面：2 个真文件从「导入本地音乐」走到列表有歌＋IDB 有 Blob＋回执环有 up/end 两笔
//   B2 迟到回执：真写成功但首笔回执谎报 false → 库里存的必须还是 Blob（红＝被转成 dataURL 字符串重存）、
//      行不许贴「文件丢失」、end 计数 ok=2 lost=0
//   B3 两头落空：IDB 恒 false ＋ localStorage 抛 QuotaExceeded → 行必须贴「文件丢失」、提示必须说出
//      「没能存进本机」、回执环必须有 lost 与 end（红＝一律报「已上传 N 首」）
//   B4 判定窗按体积放大：5MB Blob 写的挂起计时器必须 >4s（红＝沿用 4000ms）；100B 字符串写两侧皆 4000（对照）
//   B5 拒读面：FileReader 两条腿都失败 → 行不进库、提示说「没读进来」，且完成提示照样要出（不许压住）
//   Z1 全程零未捕获异常
// 用法：node tools/verify-1303-music-import-landing.mjs <被测根目录>
//   绿侧：node tools/verify-1303-music-import-landing.mjs C:/Users/Administrator/m1303/g
//   红侧（纯 HEAD 基线）：另抽一份 `git archive HEAD | tar -x -C <dir>` 副本，build 后用同一把尺子跑
//   （严禁在仓库内建 git worktree：Windows 下清理会把主树未提交改动整棵打回 HEAD）
// 首行打印被测根目录；被测根没有 index.html 直接 exit 2（防喂错产物两侧同跑假绿）。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(resolve(process.argv[2] || here));
if (!existsSync(join(root, 'index.html'))) {
  console.log('❌ 被测根目录没有 index.html：' + root + '（先在该副本跑 node build.mjs；别把 r 侧喂成 g 侧）');
  process.exit(2);
}
// 副本目录没有 node_modules（严禁在仓库内建 worktree），从主树取 playwright
const require = createRequire(join(here, 'package.json'));
const { chromium } = require('playwright');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('被测根目录 = ' + root);
console.log('serve = ' + baseUrl);

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 测试音频：16-bit PCM 单声道 WAV（与 genDemoWavJS 同形态＝本仓自带能播的那类） ----------
function wavBytes(ms, rate, hz) {
  rate = rate || 8000;
  const n = Math.floor(rate * ms / 1000);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * (hz || 440) * (i / rate)) * 12000);
    pcm.writeInt16LE(v, i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + n * 2, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(n * 2, 40);
  return Buffer.concat([head, pcm]);
}
const tmpDir = join(tmpdir(), 'm1303-audio');
mkdirSync(tmpDir, { recursive: true });
const FILES = [];
for (let i = 0; i < 2; i++) {
  const f = join(tmpDir, 't1303-' + i + '.wav');
  writeFileSync(f, wavBytes(3000, 8000, 440 + i * 110));
  FILES.push(f);
}
// 真·解不动的那一类（#1303h 的对照）：扩展名是音频、字节却是垃圾。内核在解码这一步必然
// 当场报 error（结算之前），所以两侧都该贴「放不了」——用来证明「只认结算前的 error」
// 不是把真失败一起压掉，而是只压掉 cleanupTmp 那发迟到的。
const BAD_FILE = join(tmpDir, 't1303-bad.mp3');
writeFileSync(BAD_FILE, Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(2048, 0x00), Buffer.from('not really audio at all')]));

// ---------- 进应用（开屏两道闸：滑到底＋强制公告） ----------
async function boot(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e).slice(0, 160)));
  await page.goto(baseUrl + '/index.html');
  await page.evaluate(() => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    localStorage.setItem('xy-home-v2:age-confirmed', '1');
    localStorage.setItem('xy-home-v2:splash-seen:' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), '1');
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {});
  await page.evaluate(() => { const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight; });
  await page.click('#splash-enter', { force: true }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const still = await page.evaluate(() => { const s = document.getElementById('splash'); return !!s && !s.classList.contains('hide'); });
    if (!still) break;
    await page.evaluate(() => {
      const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight;
      const m = document.getElementById('splash-mandatory'); if (m) m.hidden = false;
      const ms = document.getElementById('splash-mandatory-scroll');
      if (ms) { ms.scrollTop = ms.scrollHeight; ms.dispatchEvent(new Event('scroll')); }
      if (b) b.dispatchEvent(new Event('scroll'));
    });
    await page.evaluate(() => {
      const e = document.getElementById('splash-enter'); if (e) e.click();
      const m = document.getElementById('splash-mandatory-enter'); if (m) m.click();
    });
    await sleep(220);
  }
  await page.evaluate(() => {
    const m = document.getElementById('modal-mask'); if (m) { m.hidden = true; }
    document.querySelectorAll('.page').forEach((x) => { x.hidden = x.id !== 'page-music'; });
    const t = document.querySelector('#page-music .fav-tab[data-mtab="lib"]'); if (t) t.click();
    return !!document.getElementById('music-upload');
  });
  await sleep(400);
  await watchToasts(page);
  return { page, errs };
}
const readRing = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('xy-home-v2:__import-log') || '[]').map((x) => x.w); } catch (e) { return []; }
});
const readRows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#page-music .sm-song')).map((r) => ({
  txt: (r.textContent || '').replace(/\s+/g, ' ').slice(0, 60),
})));
// 本模块 toast 2s 自动收起（多文件场景下前一条会被后一条顶掉），所以用观察者把这一批
// 出现过的提示文本全收下来，判据不依赖「量到的是不是最后那一条」
async function watchToasts(page) {
  await page.evaluate(() => {
    if (window.__toastWatched) return;
    window.__toastWatched = true;
    window.__toasts = [];
    const grab = () => {
      const t = document.getElementById('cc-toast');
      if (!t || String(t.className || '').indexOf('show') < 0) return;
      const s = String(t.textContent || '').replace(/\s+/g, ' ').trim();
      if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s);
    };
    try { new MutationObserver(grab).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true }); } catch (e) {}
  });
}
const toastTxt = (page) => page.evaluate(() => (window.__toasts || []).join(' || '));
// IDB 里所有音频本体键
const musicKeys = (page) => page.evaluate(() => new Promise((res) => {
  try {
    const rq = indexedDB.open('mochi-db', 1);
    rq.onsuccess = () => {
      const db = rq.result, tx = db.transaction('kv', 'readonly');
      const a = tx.objectStore('kv').getAllKeys();
      a.onsuccess = () => { res(a.result.filter((x) => String(x).indexOf(':music-file:') >= 0)); try { db.close(); } catch (e) {} };
      a.onerror = () => { res([]); try { db.close(); } catch (e) {} };
    };
    rq.onerror = () => res([]);
  } catch (e) { res([]); }
}));
const idbShape = (page, key) => page.evaluate((k) => new Promise((res) => {
  try {
    const rq = indexedDB.open('mochi-db', 1);
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get(k);
      g.onsuccess = () => {
        const v = g.result;
        res(v === undefined ? 'none' : (typeof Blob !== 'undefined' && v instanceof Blob) ? 'blob:' + v.size : (typeof v === 'string' ? 'string:' + v.length : 'other'));
        try { db.close(); } catch (e) {}
      };
      g.onerror = () => { res('err'); try { db.close(); } catch (e) {} };
    };
    rq.onerror = () => res('openerr');
  } catch (e) { res('throw'); }
}), key);

// 走真 UI：点【导入本地音乐】→ 面板点【选择文件上传】→ 系统选择器灌文件
async function importViaUI(page, files) {
  const chooserP = page.waitForEvent('filechooser', { timeout: 12000 });
  await page.evaluate(() => { const b = document.getElementById('music-upload'); if (b) b.click(); });
  await page.waitForSelector('#sm-local-ok', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { const b = document.getElementById('sm-local-ok'); if (b) b.click(); });
  let chooser = null;
  try { chooser = await chooserP; } catch (e) { return false; }
  await chooser.setFiles(files);
  return true;
}
// 等这一批写入全部结算（回执环里出现 end 这笔＝结算完成）
async function waitEnd(page, budgetMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (budgetMs || 30000)) {
    const ring = await readRing(page);
    if (ring.some((w) => String(w).indexOf('music:end') === 0)) return ring;
    await sleep(300);
  }
  return await readRing(page);
}

const browser = await chromium.launch({ headless: true });
const allErrs = [];

// ================= B1 真链路成功面（两侧都该绿的对照＋新契约留证） =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  const got = await importViaUI(page, FILES);
  ok(got === true, 'B0 真 UI 走通：点【导入本地音乐】→【选择文件上传】后系统选择器被唤起');
  await waitEnd(page, 30000);
  const rows = await readRows(page);
  const ring = await readRing(page);
  const toast = await toastTxt(page);
  ok(rows.length === 2, 'B1 两首都进了歌曲列表（红侧同样绿＝这条不是判据，是对照）', 'rows=' + rows.length);
  ok(ring.some((w) => w.indexOf('music:up n=2') === 0), 'B2 回执环记下这一批的起点（music:up n=2 …）', JSON.stringify(ring));
  ok(ring.some((w) => /^music:end n=2 ok=2 lost=0/.test(w)), 'B3 回执环记下结算（ok=2 lost=0，红侧根本没有这一笔）', JSON.stringify(ring.filter((w) => w.indexOf('music:end') === 0)));
  ok(/已上传 2 首/.test(toast), 'B4 全落成真话仍照旧报「已上传 2 首」（红侧也绿＝没改成一律报失败）', JSON.stringify(toast));
  const keys = (await musicKeys(page)).slice(0, 2);
  const shapes = [];
  for (const k of keys) shapes.push(await idbShape(page, k));
  ok(shapes.length === 2 && shapes.every((s) => s.indexOf('blob:') === 0), 'B5 音频本体确实以 Blob 形态躺在 IndexedDB 里', JSON.stringify(shapes));
  allErrs.push(...errs);
  await ctx.close();
}

// ================= B6 迟到回执：写成了但首笔谎报 false（#1303b 主判据） =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => {
    const real = window.idbSet;
    let first = true;
    window.__lateStub = 0;
    window.idbSet = function (k, v) {
      const p = real(k, v); // 真写一次（会落库）
      if (String(k).indexOf(':music-file:') >= 0 && first) {
        first = false; window.__lateStub++;
        return p.then(() => false); // 回执谎报：其实已经写进去了（＝#1227 实测的「大键常超判窗、事务陆续成功」形态）
      }
      return p;
    };
  });
  const got = await importViaUI(page, [FILES[0]]);
  ok(got === true, 'B6a 场景前置：单文件选择器被唤起（没唤起＝这条不作数）');
  await waitEnd(page, 30000);
  const keys = await musicKeys(page);
  const shape = keys.length ? await idbShape(page, keys[keys.length - 1]) : 'none';
  const ring = await readRing(page);
  const rows = await readRows(page);
  ok(shape.indexOf('blob:') === 0, 'B6 首笔只是"没等到回执"时不许再做那次二次编码：库里存的必须还是 Blob（红＝被 dataURL 字符串覆盖）', 'shape=' + shape);
  ok(!rows.some((r) => r.txt.indexOf('文件丢失') >= 0), 'B6b 已落地的行不许贴「文件丢失」（红侧虽也没贴，但 B6 已红＝这条是防修过头的对照）', JSON.stringify(rows.map((r) => r.txt)));
  ok(ring.some((w) => /^music:end n=1 ok=1 lost=0/.test(w)), 'B6c 结算按"回读裁决后"的真话说 ok=1', JSON.stringify(ring.filter((w) => w.indexOf('music:end') === 0)));
  allErrs.push(...errs);
  await ctx.close();
}

// ================= B7/B8/B9 两头落空：IDB 恒 false ＋ localStorage 抛配额 =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => {
    window.idbSet = () => Promise.resolve(false); // 怎么写都不成（Blob 与 dataURL 两条腿都断）
    const si = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).indexOf(':music-file:') >= 0) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return si.call(this, k, v);
    };
  });
  const got = await importViaUI(page, [FILES[0]]);
  ok(got === true, 'B7a 场景前置：单文件选择器被唤起');
  await waitEnd(page, 40000);
  const rows = await readRows(page);
  const ring = await readRing(page);
  const toast = await toastTxt(page);
  ok(rows.length === 1, 'B7 行仍然留在列表里（不偷偷吞掉用户刚导的那首；两侧皆绿＝对照）', 'rows=' + rows.length);
  ok(rows.some((r) => r.txt.indexOf('文件丢失') >= 0), 'B8 落空的行必须当场贴「文件丢失」（红＝列表长得像"导进去了"）', JSON.stringify(rows.map((r) => r.txt)));
  ok(/没能存进本机/.test(toast), 'B9 完成提示按落地的首数说（红＝一律「已上传 1 首音乐」）', JSON.stringify(toast));
  ok(ring.some((w) => w.indexOf('music:lost') === 0), 'B10 落空那一笔在回执环留名（红＝这一环一个字没有）', JSON.stringify(ring));
  allErrs.push(...errs);
  await ctx.close();
}

// ================= B11 idbSet 判定窗按 Blob 体积放大（#1303a） =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  const r = await page.evaluate(async () => {
    const seen = [];
    const realST = window.setTimeout;
    window.setTimeout = function (fn, ms) { if (typeof ms === 'number' && ms >= 1000) seen.push(ms); return realST.apply(window, arguments); };
    const big = new Blob([new ArrayBuffer(5 * 1024 * 1024)], { type: 'audio/mpeg' });
    const okBig = await window.idbSet('xy-home-v2:__probe1303:blob', big);
    const seenBig = seen.slice();
    seen.length = 0;
    const okStr = await window.idbSet('xy-home-v2:__probe1303:str', 'x');
    const seenStr = seen.slice();
    window.setTimeout = realST;
    try { if (window.idbDelete) { window.idbDelete('xy-home-v2:__probe1303:blob'); window.idbDelete('xy-home-v2:__probe1303:str'); } } catch (e) {}
    return { okBig, okStr, seenBig, seenStr };
  });
  const maxBig = Math.max(0, ...(r.seenBig || []));
  const maxStr = Math.max(0, ...(r.seenStr || []));
  ok(maxBig > 4000, 'B11 5MB Blob 写的挂起判定窗必须随体积放大（红＝沿用 4000ms，把大 Blob 的成功判成失败）', JSON.stringify(r));
  ok(maxStr === 4000, 'B12 小键判定窗不动（对照＝放大是给大包的不是把所有人都拖长）', 'maxStr=' + maxStr);
  allErrs.push(...errs);
  await ctx.close();
}

// ================= B13 拒读面：FileReader 两条腿都失败 =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => {
    FileReader.prototype.readAsArrayBuffer = function () { const s = this; setTimeout(() => { if (s.onerror) s.onerror(new Error('stub')); }, 0); };
    FileReader.prototype.readAsDataURL = function () { const s = this; setTimeout(() => { if (s.onerror) s.onerror(new Error('stub')); }, 0); };
  });
  const got = await importViaUI(page, [FILES[0]]);
  ok(got === true, 'B13a 场景前置：单文件选择器被唤起');
  await waitEnd(page, 25000);
  const ring = await readRing(page);
  const toast = await toastTxt(page);
  ok(ring.some((w) => /^music:end n=1 ok=0 lost=0 readbad=1/.test(w)), 'B13 连字节都没读进来时不再计入成功，且完成提示照样出（红＝环里根本没这笔）', JSON.stringify(ring));
  ok(/没读进来/.test(toast) || ring.some((w) => w.indexOf('music:readfail') === 0), 'B14 拒读那一首如实点名（红＝一律报成功）', JSON.stringify({ toast, ring }));
  allErrs.push(...errs);
  await ctx.close();
}

// ================= B15 对照：真解不动的文件仍然必须贴「放不了」（#1303h 防修过头） =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  const got = await importViaUI(page, [BAD_FILE]);
  ok(got === true, 'B15a 场景前置：垃圾音频文件的选择器被唤起');
  await waitEnd(page, 25000);
  const rows = await readRows(page);
  ok(rows.some((r) => r.txt.indexOf('放不了') >= 0), 'B15 垃圾字节仍当场判「放不了」（两侧皆绿＝#1303h 只压迟到 error，没把真失败一起压掉）', JSON.stringify(rows.map((r) => r.txt)));
  allErrs.push(...errs);
  await ctx.close();
}

// ================= S0 产物锚（#1303a~g） =================
{
  const idbSrc = readFileSync(join(root, 'js/idb.js'), 'utf8');
  const mpSrc = readFileSync(join(root, 'js/music-player.js'), 'utf8');
  const anchors = [
    ['#1303a Blob 计入 idbSet 估时', idbSrc, "else if (typeof Blob !== 'undefined' && value instanceof Blob) est = value.size;"],
    ['#1303b 回读裁决', mpSrc, "if (has === true) { land(true, how + '-late'); return; }"],
    ['#1303c 两条腿都停了才报完成', mpSrc, 'if (queueDone && settledN >= list.length) done();'],
    ['#1303d 链路进持久回执环', mpSrc, "window.mochiImportLog('music:' + w)"],
    ['#1303e 载荷只造一次', mpSrc, 'const storePayload = (id, payload) => {'],
    ['#1303f dataURL 字符串不再二次编码', mpSrc, "if (typeof payload === 'string') { cb(payload); return; }"],
    ['#1303g 落空贴徽标', mpSrc, 'if (it) { try { it.fileLost = 1; } catch (e) {} }'],
    ['#1303h 探针只认结算前的 error', mpSrc, 'tmp.onerror = function () { if (settled) return;'],
  ];
  for (const [nm, src, needle] of anchors) ok(src.indexOf(needle) >= 0, 'S0 ' + nm + ' 在产物里在位', 'needle=' + needle.slice(0, 40));
}

// ================= Z1 零未捕获异常 =================
ok(allErrs.length === 0, 'Z1 全程零未捕获异常', JSON.stringify(allErrs.slice(0, 4)));

await browser.close();
server.close();
console.log('\n' + (fail ? '❌' : '✅') + ' #1303 音乐导入落盘验真：' + pass + ' 通过 / ' + fail + ' 失败（被测根目录 ' + root + '）');
process.exit(fail ? 1 : 0);
