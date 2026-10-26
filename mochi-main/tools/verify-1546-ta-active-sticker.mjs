// ===== 专项回归 #1546：TA 发布朋友圈动态时会主动贴一张贴纸 =====
// 用法：node tools/verify-1546-ta-active-sticker.mjs [被测根目录]
//
// 需求（owner 2026-10-08 直派「以前的版本，联系人发布朋友圈动态的时候会主动贴贴纸」＋选做第 2 项）。
// 考古（判「以前有没有这条」不能靠现版本倒推）：`git show 6717e4f:src/js/feed.js`（2026-09-12）里
//   写贴纸层（p.stickers）的仍然只有两路——我贴（988）与 TA 回贴（1003）；TA 自动发动态那条
//   （`fd-post-sticker`）历史上一直是把表情包推进**配图 imgs**（6717e4f:641 与今天 1097 同形）。
//   探针实测两份产物：Math.random 钉 0＋概率拉满＋种 3 张表情包卡，TA 首发动态读数＝
//   {imgs:1, stickers:0}（新旧两版同读数）。所以本批不是「恢复被删的功能」，而是把作者要的
//   那条行为**补进贴纸层**：发这条动态时按同一条概率额外贴一张。
//
// 收口（src/js/feed.js buildPost）：`g.stPool`（生成器这一轮已算好的该桌面 sticker 池，零额外扫库）
//   非空＋「朋友圈用表情包」类型闸（reply-fd-sticker-en）开着＋掷中 fd-post-sticker ⇒
//   新动态带一格 role:'ta' 的贴纸，落位走同一把 feedRandStickerPos，载荷接 #1219 令牌升级链。
//
// 手法注（为什么一把尺能跑 20 秒而不是 5 分钟）：模块级排程是 `setTimeout(..., (120+rand*180)*1000)`
//   ＋`setInterval(maybeAutoPost, 60000)`，Math.random 钉 0 后仍要等 120 秒。本尺在文档创建前把
//   **>50 秒**的定时器压到 1.5 秒（只碰这一档，2.5s 落盘合并窗、800ms 快照等一律不动），
//   并把日上限钉成 1 条 ⇒ 「TA 首发那一条」变成确定性事件而不是等钟点。
//
// 断言：S1~S3 本批逻辑锚（产物侧）／B1 发动态带一张 TA 贴纸（红侧恒 0＝判别力实证）／
//   B2 旧契约不动：表情包配图照旧出（两侧皆绿）／B3 类型闸关掉＝不贴（防修过头）／Z 零未捕获异常。
const rootArg = process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || process.cwd();
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { chromium } from 'playwright';
const ROOT = resolve(normalize(rootArg));
console.log('被测根目录 = ' + ROOT);
if (!existsSync(join(ROOT, 'index.html'))) { console.error('✗ 被测根目录没有 index.html（喂错目录＝整组红得像"修复没生效"）'); process.exit(2); }
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

function img(seed) {
  const w = 40, h = 40, row = w * 3, size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10);
  buf.writeInt32LE(size, 18); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  buf.fill((seed % 250) + 5, 54);
  return 'data:image/bmp;base64,' + buf.toString('base64');
}
const CARDS = [img(1), img(2), img(3)];
const browser = await chromium.launch();
const results = [];
function check(desc, ok, detail) {
  results.push({ ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

function initSrc(o) {
  const pairs = [['reply-fd-post-en', 1], ['reply-fd-post-prob', 100], ['reply-fd-post-sticker', o.stickerProb],
    ['reply-fd-post-image', 100], ['reply-fd-post-kaomoji', 0], ['reply-fd-post-emoji', 0],
    ['reply-fd-min-cards-post', 2], ['reply-fd-max-cards-post', 3], ['reply-fd-min-interval', 1], ['reply-fd-max-interval', 1],
    ['reply-fd-post-daily-max', 1], ['reply-fd-post-cool', 1], ['reply-fd-comment-prob', 0], ['reply-fd-like-prob', 0],
    ['reply-fd-likeback-prob', 0], ['reply-fd-reply-prob', 0], ['reply-fd-sticker-en', o.stickerEn], ['reply-fd-image-en', 1]];
  return `(function(){
    Math.random = function () { return 0; };
    var st = window.setTimeout, si = window.setInterval;
    window.setTimeout = function (f, d) { var a = [].slice.call(arguments, 2); return st.apply(window, [f, d > 50000 ? 1500 : d].concat(a)); };
    window.setInterval = function (f, d) { var a = [].slice.call(arguments, 2); return si.apply(window, [f, d > 50000 ? 1500 : d].concat(a)); };
    if (localStorage.getItem('__v1546seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1546seed', '1');
    ${pairs.map(([k, v]) => `localStorage.setItem('xy-home-v2:default:${k}', '${v}');`).join('\n    ')}
    localStorage.setItem('xy-home-v2:cc-scope-migrated', '1');
    localStorage.setItem('xy-home-v2:default:cc-groups', JSON.stringify({
      text: [['文字', ['你好呀', '今天也要加油', '记得吃饭']]], kaomoji: [], emoji: [],
      sticker: [['贴纸组', [${JSON.stringify(CARDS[0])}, ${JSON.stringify(CARDS[1])}, ${JSON.stringify(CARDS[2])}]]],
      image: [['图组', [${JSON.stringify(CARDS[0])}]]], poke: [], voice: []
    }));
  })()`;
}
async function run(o) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  await ctx.addInitScript(initSrc(o));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__mochiDataReady', null, { timeout: 30000 }).catch(() => {});
  let n = 0;
  for (let i = 0; i < 24; i++) {
    await sleep(1500);
    n = await page.evaluate(`(function(){
      var raw = null;
      try { raw = window.xyStore('xy-home-v2').get('feed-posts'); } catch (e) { return -1; }
      var arr = []; try { arr = JSON.parse(raw || '[]') || []; } catch (e) { return -1; }
      return arr.filter(function (p) { return (p.role || p.by) === 'ta'; }).length;
    })()`);
    if (n > 0) break;
  }
  return { ctx, errs, page, n };
}
// 终态读数（贴纸那格取不取自池内，要在页内比对同一批常量）
async function finalRead(page) {
  return page.evaluate(`(function(){
    var CARDS = ${JSON.stringify(CARDS)};
    var out = { pool: 0, taN: 0, stk: 0, stkRole: null, stkKind: 'none', stkPos: null, imgs: 0 };
    try { out.pool = (window.getMediaCardsFor && window.getMediaCardsFor('default', 'sticker') || []).length; } catch (e) { out.poolErr = String(e).slice(0, 50); }
    var raw = null;
    try { raw = window.xyStore('xy-home-v2').get('feed-posts'); } catch (e) {}
    var arr = []; try { arr = JSON.parse(raw || '[]') || []; } catch (e) { out.dataErr = String(e).slice(0, 50); }
    var ta = arr.filter(function (p) { return (p.role || p.by) === 'ta'; });
    out.taN = ta.length;
    if (ta.length) {
      var ss = ta[0].stickers || [];
      out.stk = ss.length;
      out.stkRole = ss.length ? (ss[0].role || ss[0].owner) : null;
      // #1219 令牌升级链会把刚写进去的 dataURL 就地换成 @@m:hash 引用（池确认后），
      // 所以「取自池内」有两种合法形态：原样 dataURL 或 32 位十六进制令牌。
      var s0 = ss.length ? String(ss[0].src || '') : '';
      out.stkKind = CARDS.indexOf(s0) >= 0 ? 'data' : (/^@@m:[0-9a-f]{32}$/.test(s0) ? 'token' : (s0 ? 'other' : 'empty'));
      out.stkPos = ss.length ? [ss[0].x, ss[0].y] : null;
      out.imgs = (ta[0].imgs || []).length;
    }
    return out;
  })()`);
}

// ================= S 组：本批逻辑锚（产物侧） =================
check('S1 发动态那一路接了主动贴（掷同一条 fd-post-sticker＋该桌面 sticker 池非空＋类型闸开着）',
  artifact.includes("if (g.stPool && g.stPool.length && feedTypeOn(cid, 'sticker') && Math.random() * 100 < cfg.postSticker) {"));
check('S2 贴纸载荷走 #1219 令牌升级链（漏接＝整张 dataURL 顶进权威键 feed-posts，大键线一过就被剥图）',
  artifact.includes('if (taStk) feedStickerTokUpgrade(post.id, taStk);'));
check('S3 取的是生成器这一轮已算好的池（零额外扫库，#931 卡顿族口径）',
  artifact.includes('stPool: uniqArr(pool.sticker)'));

// ================= B 组 =================
{
  const r = await run({ stickerProb: 100, stickerEn: 1 });
  const d = await finalRead(r.page);
  check('B0 夹具真实：该桌面 sticker 池 3 张、TA 首发那一条动态已落库', d.pool === 3 && d.taN === 1, d);
  check('B1 TA 发这条动态时主动贴了一张（role=ta、取自池内 dataURL 或 #1219 令牌、有落位；红侧恒 0＝症状本尊）',
    d.stk === 1 && d.stkRole === 'ta' && (d.stkKind === 'data' || d.stkKind === 'token') && Number.isFinite(d.stkPos[0]), d);
  check('B2 旧契约不动：表情包配图照旧进 imgs（主动贴不是把配图那格顶掉）', d.imgs >= 1, d);
  check('Z1 发动态链路零未捕获异常', r.errs.length === 0, r.errs.slice(0, 3));
  await r.ctx.close();
}
{
  const r = await run({ stickerProb: 100, stickerEn: 0 });
  const d = await finalRead(r.page);
  check('B3 「朋友圈用表情包」类型闸关掉＝一张都不贴（防修过头：设置关了就彻底消失）',
    d.taN === 1 && d.stk === 0, d);
  check('Z2 类型闸关那一路零未捕获异常', r.errs.length === 0, r.errs.slice(0, 3));
  await r.ctx.close();
}

await browser.close();
server.close();
const red = results.filter((x) => !x.ok).length;
console.log(red ? 'FAIL ' + red + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length);
process.exit(red ? 1 : 0);
