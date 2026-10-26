// ===== 专项回归 #1545：朋友圈 TA 回贴要过得了页面回收（欠账落格＋回场补投） =====
// 用法：node tools/verify-1545-feed-sticker-owed.mjs [被测根目录]（或 SERVE_ROOT=…）
//
// 现场（owner 2026-10-08 直派「我贴了贴纸后，也没有触发联系人回复贴纸」）：TA 回贴是掷中
//   fd-comment-prob（默认 70%）才排程的，而那一发只活在 setTimeout 里（延时 fd-comment-speed-min~max，
//   默认 1~60 秒）。这期间刷新／切后台／页面被系统回收＝那一发连同定时器一起消失，重开既没补发
//   也没提示＝用户所见「联系人不回贴」。聊天同族已由 #1356d~f 收口，朋友圈贴纸这条没接。
//
// 收口（src/js/feed.js，判据零机型／零 UA）：掷中那一刻把承诺写进【我贴的那一格】
//   （rec.owed=1，随 feed-posts 权威键落盘，零新增存储键）；回场认账只认「最后一格是我贴的、
//   它欠、且是今天贴的」；补投体接 #1485a 的 poolReadyFor，读不到动态改有界重试而非静默 return。
//
// 断言：
//   S 组 本批新契约的逻辑锚（产物侧，名字在、实现被换掉照样红）
//   B1 症状本体＝上一场欠的那一发，重开后要落进动态与权威键（纯 HEAD 恒 0＝红）
//   B2 只补一发（不重复兑现）＋兑现时把欠账标记摘掉
//   B3 没掷中的不补（防「一律补投」修过头）／B4 已兑现的不补／B5 隔天旧账不翻
//   B6 本场真点一张：旧链路照常一发，且认账钩子不会被它触发第二次（两侧皆绿＝旧契约不动）
//   Z1 全程零未捕获 JS 异常
//
// 纯 HEAD 侧预期：B1/B2 与 S1~S4 恰红（全本批新契约），B3~B6/Z 两侧皆绿。
const rootArg = process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || process.cwd();
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(normalize(rootArg));
console.log('被测根目录 = ' + ROOT);
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像"修复没生效"）');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const artifact = readFileSync(join(ROOT, 'js', 'feed.js'), 'utf8');

function img(seed, w, h) {
  w = w || 200; h = h || 200;
  const row = w * 3, size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10);
  buf.writeInt32LE(size, 18); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  buf.fill((seed % 250) + 5, 54);
  return 'data:image/bmp;base64,' + buf.toString('base64');
}
const PHOTO = img(9, 60, 60), SMALL = img(5, 8, 8);
// 种子动态落在默认那一页（本自然周）里，否则断言被月度折叠页吃掉（口径同 #1434）
const T = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() + 60000; })();
const DAY_START = new Date().setHours(0, 0, 0, 0);
// 上一场的欠账：今天、且早于本场起点（跨午夜那 5 秒内取当日 00:00:01，绝不落到昨天）
const DEBT_TS = Math.max(DAY_START + 1000, Date.now() - 5000);
const POST_ID = 'f_1545_probe';
const mkPost = (stickers) => JSON.stringify([{
  id: POST_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '',
  content: '今天的天空很好看', imgs: [PHOTO], stickers, ts: T, likes: [], comments: []
}]);
const meStk = (ts, owed) => ({ src: SMALL, emoji: '', x: 20, y: 20, ts, role: 'me', owner: 'me', authorName: '我', ...(owed ? { owed: 1 } : {}) });
const taStk = (ts) => ({ src: SMALL, emoji: '', x: 60, y: 60, ts, role: 'ta', owner: 'default', authorName: '小桃' });

const browser = await chromium.launch();
const results = [];
function check(desc, ok, detail) {
  results.push({ ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

function initSrc(commentProb) {
  const pairs = [['reply-fd-comment-prob', commentProb], ['reply-fd-likeback-prob', 0], ['reply-fd-reply-prob', 0],
    ['reply-fd-post-prob', 0], ['reply-fd-comment-speed-min', 1], ['reply-fd-comment-speed-max', 2]];
  return `(function(){
    if (localStorage.getItem('__v1545seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1545seed', '1');
    ${pairs.map(([k, v]) => `localStorage.setItem('xy-home-v2:default:${k}', '${v}');`).join('\n    ')}
    localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['贴纸组', [${JSON.stringify(SMALL)}]]]));
  })()`;
}
async function enter(page) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__mochiDataReady', null, { timeout: 30000 }).catch(() => {});
  await sleep(2200);
  await page.evaluate(`(function(){ document.querySelectorAll('.splash,.splash-notice,.splash-box').forEach(function(n){ n.classList.add('hide'); n.style.display='none'; }); var el=document.querySelector('.app[data-app="feed"]'); if(el) el.click(); })()`);
  await sleep(1200);
}
// 造一场「上一场留下的动态」：先进去写权威键，再重载＝新会话起点必然晚于贴纸 ts
async function session(seedJson, commentProb) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await ctx.addInitScript(initSrc(commentProb));
  await enter(page);
  await page.evaluate(`(function(){ window.xyStore('xy-home-v2').set('feed-posts', ${JSON.stringify(seedJson)}); })()`);
  await sleep(600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enter(page);
  return { ctx, page, errs };
}
const read = (page) => page.evaluate(`(function(){
  var out = { debtFired: window.__feedStickerDebtFired || 0, replyFired: window.__feedStickerReplyFired || 0, miss: window.__feedStickerReplyMiss || 0 };
  var raw = null;
  try { raw = window.xyStore('xy-home-v2').get('feed-posts'); } catch (e) {}
  try {
    var arr = JSON.parse(raw); var p = arr.filter(function (x) { return x.id === ${JSON.stringify(POST_ID)}; })[0];
    var ss = (p && p.stickers) || [];
    out.stkTotal = ss.length;
    out.stkTa = ss.filter(function (s) { return (s.role || s.owner) === 'ta'; }).length;
    var lastMe = null;
    for (var i = ss.length - 1; i >= 0; i--) { if ((ss[i].role || ss[i].owner) === 'me') { lastMe = ss[i]; break; } }
    out.owed = lastMe ? (lastMe.owed === undefined ? 'absent' : lastMe.owed) : 'no-me';
  } catch (e) { out.dataErr = String(e).slice(0, 80); }
  var c = document.querySelector('.feed-post');
  var box = c && c.querySelector('.feed-imgs');
  out.domTa = box ? box.querySelectorAll('.feed-sticker:not([data-sticker-del])').length : -1;
  out.domTotal = box ? box.querySelectorAll('.feed-sticker').length : -1;
  return out;
})()`);
async function waitTa(page, n, ms) {
  let r = await read(page);
  for (let i = 0; i < (ms || 20); i++) {
    if (r.stkTa >= n) break;
    await sleep(1000);
    r = await read(page);
  }
  return r;
}

// ================= S 组：本批逻辑锚（产物侧） =================
check('S1 掷中的承诺写进我贴那一格（删＝那一发又只活在 setTimeout 里，回收即永远不回贴）',
  artifact.includes('if (Math.random() * 100 < cfg.commentProb) rec.owed = 1;'));
check('S2 回场认账判据＝最后一格是我贴的且它欠（改成无条件补投＝把「没掷中」当欠，TA 开始凭空贴）',
  artifact.includes('if (last.owed !== 1) return;'));
check('S3 补投读不到动态时有界重试（回流＝if (!p2) return 的静默作废）',
  artifact.includes('if ((tries || 0) < 2) { feedTaStickerReply(pid, cid, cfg, 1500, (tries || 0) + 1); return; }'));
check('S4 补投体接该桌面字卡就绪（#1485a 同口径）＋兑现时摘欠账标记',
  artifact.includes('poolReadyFor(cid, function () {') && artifact.includes("if (sOld && (sOld.role || sOld.owner) === 'me') { sOld.owed = 0; break; }"));

// ================= B1/B2 症状本体：上一场欠的那一发 =================
{
  const { ctx, page, errs } = await session(mkPost([meStk(DEBT_TS, true)]), 100);
  const r = await waitTa(page, 1, 20);
  check('B1 重开后上一场欠的 TA 回贴要落进动态与权威键（纯 HEAD＝恒 0，症状本体）',
    r.stkTa === 1 && r.stkTotal === 2 && r.debtFired >= 1 && r.domTa === 1, r);
  await sleep(4000);
  const r2 = await read(page);
  check('B2 只补一发（不重复兑现）且欠账标记已摘',
    r2.stkTa === 1 && r2.stkTotal === 2 && r2.owed !== 1, r2);
  check('Z1 补投链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// ================= B3 没掷中的不补（防修过头） =================
{
  const { ctx, page } = await session(mkPost([meStk(DEBT_TS, false)]), 100);
  await sleep(6000);
  const r = await read(page);
  check('B3 上一场没掷中（格上没有欠账标记）＝不补（否则 TA 凭空贴）',
    r.stkTa === 0 && r.stkTotal === 1 && r.debtFired === 0, r);
  await ctx.close();
}

// ================= B4 已兑现的不补 =================
{
  const { ctx, page } = await session(mkPost([meStk(DEBT_TS, true), taStk(DEBT_TS + 500)]), 100);
  await sleep(6000);
  const r = await read(page);
  check('B4 最后一格是 TA 的＝那一发已兑现，不再补',
    r.stkTa === 1 && r.stkTotal === 2 && r.debtFired === 0, r);
  await ctx.close();
}

// ================= B5 隔天旧账不翻 =================
{
  const { ctx, page } = await session(mkPost([meStk(DAY_START - 86400000, true)]), 100);
  await sleep(6000);
  const r = await read(page);
  check('B5 昨天及更早的欠账归历史＝不翻旧账',
    r.stkTa === 0 && r.stkTotal === 1 && r.debtFired === 0, r);
  await ctx.close();
}

// ================= B6 本场真点：旧链路一发，认账钩子不多补 =================
{
  const { ctx, page, errs } = await session(mkPost([]), 100);
  await page.evaluate(`(function(){ var c=document.querySelector('.feed-post'); var b=c&&c.querySelector('.feed-act[data-sticker]'); if(b) b.click(); })()`);
  await sleep(800);
  await page.evaluate(`(function(){ var its=[].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item')); if(its[0]) its[0].click(); })()`);
  await sleep(800);
  await page.evaluate(`(function(){ var box=document.querySelector('.feed-post .feed-imgs'); if(!box) return; var r=box.getBoundingClientRect(); box.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*0.5,clientY:r.top+r.height*0.5})); })()`);
  const r = await waitTa(page, 1, 20);
  await sleep(4000);
  const r2 = await read(page);
  check('B6 本场自己贴的走原链路、只回一条（旧契约不动，两侧皆绿）',
    r2.stkTotal === 2 && r2.stkTa === 1 && r2.debtFired === 0, r2);
  check('Z2 真点＋回贴链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

await browser.close();
server.close();
const red = results.filter((r) => !r.ok).length;
console.log((red ? 'FAIL ' + red + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length));
process.exit(red ? 1 : 0);
