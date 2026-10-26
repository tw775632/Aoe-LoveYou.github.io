// ===== 回归脚本 #1320：气泡头像的第二把写入面（回前台／双开／回填／设置页那一扇门）＋全站「令牌当 src 写」穷举
// 背景（用户复报「这个问题还是没有完全修好啊」，红米 K80/Chrome，明说其他机型也有、要求不要覆盖式修补）：
//   #1314 收的是「点头像格换头像」那一路（avatar-lib 的 applyAvatarImg），而同一句症状还有第二扇门＝
//   chat.js 的 refreshChatAvatars。纯 tip 1aba93f 无头实测（390×844、300 条历史）：一次 refreshChatAvatars
//   ＝整窗 101 个气泡头像在**同一次任务**里全部重新赋值（span:0），屏上只有 7 个看得见而它们排在最后
//   （writes:101 uniq:101 vis:7 off:94 lastVis:100 > firstOff:0）。走这扇门的触发路实测同形四条：
//   ① 回前台 visibilitychange（avatar-lib 的 convergeAvatars）② mochi-fg-resume ③ mochi-restore-done（回填后
//   强制收敛）④ 聊天设置页那四处直接调 window.refreshChatAvatars()。＝「切出去看一眼再回来，整列头像一起
//   闪／重新加载」，与 #1314 同形、门不同。
//   另一件：#1314 那把尺子（池的唯一落图入口 mochiMediaPaint，令牌永不上屏）只覆盖了表情面板与头像库；
//   其余把「池视图里的值」直接写进 src 的入口照旧＝每格先坏一次（内核把 @@m:<hash> 当相对 URL 真发一次必
//   404 的请求）再从零解一次。K 组不靠猜：真驱动各入口（字卡库各分类／表情面板／头像库／群聊／朋友圈／
//   全部朋友圈／设置各页），凡读到一次「src 落的是 @@m: 令牌」就按栈顶点名，并数内核真发出去的 /@@m: 请求。
//   判据一律零机型／零 UA 分支＝只问「写入的是令牌还是载荷」「这一格此刻画不画得出来」。
// 夹具纪律（#1314 的课原样继承，别再踩）：
//   · 探针必须 ctx.addInitScript 装在 **document-start**；晚装一截就把写入与 404 回执整段看不见，把被测量
//     读成「零写入」＝误判对方没症状。
//   · 分档判据按**写入当时**的几何量，不拿触发那一刻的节点身份快照当筛子。
//   · 每一轮先证「写入面真被尺子数到」（去重节点≥30 且可见／屏外两档都有写入）才拿去判；不构成就整轮重来
//     （最多三轮），三轮都不构成照最后一次判红——不许挑好看的轮次，更不许拿空读数当结论。
//   · 靶值按值挑（与现值不同才构成写入面；#617 的守卫是「值没变＝DOM 一律不碰」）。
//   · K 组每一发驱动完先看「这一发真渲染出 img 没有」；没渲染出 img 的入口读数无意义。本脚本第一版就因为
//     tab 选择器写错（真实值是 data-page="page-chatcard"，写成 "chatcard"）让 6 个入口全读 writes:0＝夹具没跑，
//     不是没症状。K0/G0 这类前置断言就是为此而设。
// 用法：node tools/verify-1320-avatar-second-surface.mjs <被测根目录>   （两侧＝同一把尺子，只换根目录）
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('被测根目录: ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('没有产物 index.html，先 node build.mjs'); process.exit(2); }
let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ' ' + JSON.stringify(detail === undefined ? '' : detail)); }
}

// ---------- S 组：本批新针的静态锚（与 build.mjs 的 FIX_SENTINELS #1320a~g 同一批字符串）----------
const ANCHORS = [
  ['S1 = #1320a 气泡头像落图交回池的唯一入口（改现有节点那一支）', 'js/chat.js', 'emojiPaintSrc(cur, data);'],
  ['S2 = #1320b 新建节点那一支同尺（不许留一处直写）', 'js/chat.js', 'emojiPaintSrc(img, data);'],
  ['S3 = #1320c 第二把写入面按可见性分档（可见当场落、屏外进 tail）', 'js/chat.js', 'if (!el.isConnected || !r || (r.bottom > -80 && r.top < vh + 80)) head.push(p); else tail.push(p);'],
  ['S4 = #1320d 屏外分片每片 24 个、在后续帧补齐', 'js/chat.js', 'for (let i = 0; i < 24 && tail.length; i++) { const p = tail.shift(); fillAvatar(p.el, p.key); }'],
  ['S5 = #1320e 分片带轮次号（期间又刷新一轮时旧一轮剩下的作废）', 'js/chat.js', 'const gen = ++chatAvApplyGen;'],
  ['S6 = #1320f 拿不到视口／没有 rAF 一律照旧一次写完（最坏等于今天）', 'js/chat.js', 'if (!vh || !window.requestAnimationFrame) { for (const p of pairs) fillAvatar(p.el, p.key); return; }'],
  ['S7 = #1320g 整窗刷新只经这一把分档入口（refreshChatAvatars 不再逐格直刷）', 'js/chat.js', 'chatAvPaintRound(pairs);'],
];
for (const [name, file, needle] of ANCHORS) {
  let text = '';
  try { text = readFileSync(join(root, file), 'utf8'); } catch (e) { text = ''; }
  chk('S ' + name + '（产物 ' + file + ' 内恰命中 1 次）', text.split(needle).length - 1 === 1, { hits: text.split(needle).length - 1 });
}
// N 组前置：#1314 那十二针在场＝本批不许把邻居刚落的尺子打回（同名同文本，逐条数）
const N1314 = [
  ['js/media-pool.js', 'window.mochiMediaPaint = function (el, val, done) {'],
  ['js/media-pool.js', 'try { el.__moPaint = 1; } catch (eF) {}'],
  ['js/media-pool.js', 'if (cur) { paintFinish(el, it.done, false); continue; }'],
  ['js/media-pool.js', 'setTimeout(function () { paintDeliver(h, map.get(h) || null); }, PAINT_WAIT_MS);'],
  ['js/chat.js', 'emojiPaintSrc(im, ds);'],
  ['js/chat.js', 'emojiPaintSrc(img, img.__emojiLazySrc || img.dataset.src);'],
  ['js/chat.js', 'if (im.__moPaint) return;'],
  ['js/chat.js', 'emojiPaintSrc(im, im.dataset.src, function (ok)'],
  ['js/avatar-lib.js', 'avPaintSrc(im, ds);'],
  ['js/avatar-lib.js', 'avPaintSrc(im, im.dataset.src, function (ok)'],
  ['js/avatar-lib.js', 'if (!r || (r.bottom > -80 && r.top < vh + 80)) applyTo(av);'],
  ['js/avatar-lib.js', 'const avGen = ++avApplyGen;'],
];
const missing1314 = [];
for (const [file, needle] of N1314) {
  let text = '';
  try { text = readFileSync(join(root, file), 'utf8'); } catch (e) { text = ''; }
  if (text.split(needle).length - 1 < 1) missing1314.push(file + ' :: ' + needle.slice(0, 40));
}
chk('N1 #1314 十二针一字未动（本批不许打回邻居刚落的尺子）', missing1314.length === 0, { missing: missing1314 });

// ---------- 夹具：可解码的真体量 BMP（>64KB 才进媒体池令牌化 pass）----------
function bmp(side) {
  const row = side * 3, pad = (4 - (row % 4)) % 4, px = row + pad, size = 54 + px * side;
  const b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(side, 18); b.writeInt32LE(side, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(px * side, 34);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const o = 54 + y * px + x * 3; b[o] = (x * 11 + y * 5) & 255; b[o + 1] = (x * 3 + y * 13) & 255; b[o + 2] = (x * 17 + y) & 255;
  }
  return 'data:image/bmp;base64,' + b.toString('base64');
}
const ST = Array.from({ length: 10 }, (_, i) => bmp(360 + i));   // 贴纸／图片字卡：每张 ~390KB
const AV = Array.from({ length: 8 }, (_, i) => bmp(200 + i));    // 头像：正常量级（内联值，逐格不同）

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });

// 页内探针：按节点身份记每一笔 src 赋值（属性／属性描述符两条通道都盖），写入当时的几何、值形态、栈顶
const PROBE = `(function(){
  if (window.__v1320) return true;
  window.__v1320 = { w: [], ev: [], seq: 0, ids: new WeakMap(), frame: 0 };
  (function tick(){ window.__v1320.frame++; try { requestAnimationFrame(tick); } catch(e){} })();
  function idOf(n){ var m=window.__v1320.ids; if(!m.has(n)) m.set(n, ++window.__v1320.seq); return m.get(n); }
  window.__v1320.idOf = idOf;
  function kind(n){
    if (n.closest && n.closest('.msg-av')) return 'bubble';
    if (document.getElementById('emoji-list') && document.getElementById('emoji-list').contains(n)) return 'emoji';
    if (document.getElementById('avlib-grid') && document.getElementById('avlib-grid').contains(n)) return 'avlib';
    var pg = n.closest ? n.closest('.page') : null;
    return pg ? pg.id : 'other';
  }
  function visAt(n){
    if (!n.isConnected) return 0;
    var vh = window.innerHeight || 0; if (!vh) return 0;
    var r = null; try { r = n.getBoundingClientRect(); } catch (e) { return 0; }
    if (!r) return 0;
    return (r.bottom > -80 && r.top < vh + 80) ? 1 : 0;
  }
  function stack(){ return (new Error().stack||'').split('\\n').slice(1,4).map(function(s){return s.trim().replace(/https?:[^)]*\\//,'');}).join(' <- '); }
  var dp = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute');
  Element.prototype.setAttribute = function(k,v){
    if (this.tagName==='IMG' && k==='src') window.__v1320.w.push({ id: idOf(this), kind: kind(this), bv: visAt(this), tok: String(v).slice(0,4)==='@@m:', pay: String(v).slice(0,5)==='data:', fr: window.__v1320.frame, st: stack() });
    return dp.value.call(this,k,v);
  };
  var dpp = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable:true, get: dpp.get, set: function(v){
    window.__v1320.w.push({ id: idOf(this), kind: kind(this), bv: visAt(this), tok: String(v).slice(0,4)==='@@m:', pay: String(v).slice(0,5)==='data:', prop:1, fr: window.__v1320.frame, st: stack() });
    dpp.set.call(this,v);
  }});
  ['load','error'].forEach(function(e){ document.addEventListener(e, function(x){ var t=x.target; if(!t||t.tagName!=='IMG') return; window.__v1320.ev.push({ ev:e, id:idOf(t), kind:kind(t), s:String(t.getAttribute('src')||'').slice(0,16) }); }, true); });
  window.__v1320.clr = function(){ window.__v1320.w.length = 0; window.__v1320.ev.length = 0; };
  // 气泡头像这一档的写入先后（R 组的尺子）：只数「写入当时看得见／看不见」两档
  window.__v1320.bubble = function(){
    var seq = window.__v1320.w.filter(function(x){ return x.kind==='bubble'; });
    var lastVis=-1, firstOff=-1, maxVisFr=-1, minOffFr=-1, vis=0, off=0, fmin=1e9, fmax=-1, tok=0, tokSt={};
    seq.forEach(function(x,i){
      if (x.fr<fmin) fmin=x.fr; if (x.fr>fmax) fmax=x.fr;
      if (x.tok){ tok++; tokSt[x.st]=(tokSt[x.st]||0)+1; }
      if (x.bv===1){ vis++; lastVis=i; if (x.fr>maxVisFr) maxVisFr=x.fr; }
      else { off++; if (firstOff<0) firstOff=i; if (minOffFr<0 || x.fr<minOffFr) minOffFr=x.fr; }
    });
    return { writes: seq.length, uniq: new Set(seq.map(function(x){return x.id;})).size, visDone: vis, offDone: off, lastVis: lastVis, firstOff: firstOff, maxVisFr: maxVisFr, minOffFr: minOffFr, span: seq.length?(fmax-fmin):-1, tokWrites: tok, tokStacks: tokSt };
  };
  // 全站令牌账（K 组的尺子）：任何一档写过 @@m: 都点名，附带这一发真渲染出多少 img
  window.__v1320.tokens = function(){
    var tok=0, byKind={}, stacks={};
    for (var i=0;i<window.__v1320.w.length;i++){ var x=window.__v1320.w[i]; if(!x.tok) continue; tok++; byKind[x.kind]=(byKind[x.kind]||0)+1; stacks[x.st]=(stacks[x.st]||0)+1; }
    var errs=0, seen={}; for (var j=0;j<window.__v1320.ev.length;j++){ var e2=window.__v1320.ev[j]; if (e2.ev!=='error'||seen[e2.id]) continue; seen[e2.id]=1; errs++; }
    var imgs=[].slice.call(document.querySelectorAll('img')), domTok=0, payNow=0, ready=0;
    for (var k=0;k<imgs.length;k++){ var im=imgs[k]; var s=im.getAttribute('src')||''; if (s.indexOf('@@m:')===0) domTok++; else if (s.indexOf('data:')===0) payNow++; if (im.complete && im.naturalWidth>0) ready++; }
    return { writes: window.__v1320.w.length, tokWrites: tok, byKind: byKind, stacks: stacks, errs: errs, domImg: imgs.length, domTok: domTok, payNow: payNow, ready: ready };
  };
  return true;})()`;
// 探针必须装在 document-start（addInitScript）：#907 的空闲预热排在 load+4s，各模块的落图更早；
// 晚装的那一截写入与内核回执全看不见＝把被测量读成「零写入」，实测踩过（#1314 同一课）。
await ctx.addInitScript({ content: PROBE });

const SPLASH_STEP = `(function(){
  var mm=document.getElementById('splash-mandatory');
  if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll'); if(sc)sc.scrollTop=sc.scrollHeight;
    var m=document.getElementById('splash-mandatory-enter'); if(m&&!m.classList.contains('is-disabled')){m.click();return 'mc';} return 'mw';}
  var sp=document.getElementById('splash'); if(!sp||sp.classList.contains('hide')) return 'closed';
  var sb=document.getElementById('splash-box'); if(sb)sb.scrollTop=sb.scrollHeight;
  var se=document.getElementById('splash-enter'); if(se&&!se.disabled){se.click();return 'c';} return 'w';})()`;
async function dismissSplash(page) {
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(SPLASH_STEP);
    if (s === 'closed') break;
    await sleep(300);
  }
  await page.evaluate(() => {
    ['splash-mandatory', 'qa-mask', 'backup-remind-bar', 'modal-mask'].forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = true; });
    const sp = document.getElementById('splash'); if (sp) { sp.classList.add('hide'); sp.hidden = true; }
    document.querySelectorAll('.modal-mask').forEach((m) => { m.hidden = true; });
    return true;
  });
  await sleep(400);
}
async function gotoTab(page, which) { // 真实值是 data-page="page-xxx"（写错＝入口根本没跑，K 组的前置就是防这个）
  return page.evaluate((w) => { const t = document.querySelector('.tab[data-page="' + w + '"]'); if (t) t.click(); return !!t; }, which);
}

const page = await ctx.newPage();
const jsErrs = [];
const tokReqAll = [];
page.on('request', (r) => { if ((r.url() || '').indexOf('@@m') >= 0) tokReqAll.push(r.url()); });
page.on('pageerror', (e) => { jsErrs.push(String(e.message)); });
await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.xyStore && !!window.activePrefix, null, { timeout: 40000 });
await dismissSplash(page);

const seed = await page.evaluate(({ st, av }) => {
  const s = window.xyStore(window.activePrefix());
  s.set('cc-groups', JSON.stringify({ text: [], kaomoji: [], emoji: [], sticker: [['G1', st.slice(0, 4)]], image: [['G2', st.slice(4, 9).map((u, i) => '图' + (i + 1) + '|||' + u)]], poke: [], voice: [] }));
  s.set('emoji-last', JSON.stringify({ mode: 'ta', ta: 'G1', mine: 'G1', pub: '' }));
  s.set('avatar-lib', JSON.stringify(av));
  s.set('cs-avatar-partner', av[0]);
  s.set('cs-avatar-user', av[1]);
  const msgs = [];
  for (let i = 0; i < 300; i++) msgs.push({ side: i % 2 ? 'in' : 'out', text: '历史消息 ' + i, ts: Date.now() - (300 - i) * 60000 });
  s.set('chat-msgs', JSON.stringify(msgs));
  // 群聊：库里先放内联大图，模块自己的 pass（group-chat.js 的 mochiMediaTokenize）会把它换令牌
  localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify([
    { side: 'out', type: 'sticker', text: st[0], ts: Date.now() - 5000 },
    { side: 'in', type: 'sticker', text: st[1], ts: Date.now() - 4000 },
    { side: 'out', type: 'image', text: st[2], ts: Date.now() - 3000 },
  ]));
  return { cid: window.__activeCid || 'default' };
}, { st: ST, av: AV });
// 朋友圈：发帖时 feed 自己会把图令牌化（feedTokImgs），库里存的就是令牌——按稳态直接种令牌
const feedTok = await page.evaluate(async ({ st, cid }) => {
  const got = [];
  for (const u of st.slice(0, 3)) { try { got.push(await window.mochiMediaTokenize(u)); } catch (e) { got.push(null); } }
  try { await window.mochiMediaFlush(); } catch (e) {}
  const real = got.filter((t) => t && t.indexOf('@@m:') === 0);
  if (real.length) {
    window.xyStore(window.activePrefix()).set('feed-posts', JSON.stringify(real.map((t, i) => ({
      content: '取证配图 ' + i, imgs: [t], ts: Date.now() + i, owner: cid, role: 'ta',
    }))));
  }
  return { got: real.length, shape: (real[0] || '').slice(0, 6) };
}, { st: ST, cid: seed.cid });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.xyStore && !!window.activePrefix, null, { timeout: 40000 });
await dismissSplash(page);
await page.evaluate(() => { try { window.enterChat(); } catch (e) {} return true; });

// 令牌化 pass 只改**池视图**（原始库键一字不动）⇒ 判「库里是不是令牌」必须问 getScopedGroups
async function poolView() {
  return page.evaluate(() => {
    const out = {};
    for (const cat of ['sticker', 'image']) {
      const gs = (window.getScopedGroups && window.getScopedGroups(cat, 'own')) || [];
      let tok = 0, n = 0;
      for (const g of gs) for (const c of (g[1] || [])) { n++; if (String(c).indexOf('@@m:') >= 0) tok++; }
      out[cat] = { n, tok };
    }
    return out;
  });
}
let pv = { sticker: { n: 0, tok: 0 }, image: { n: 0, tok: 0 } };
for (let i = 0; i < 24; i++) { pv = await poolView(); if (pv.sticker.tok >= 4) break; await sleep(1500); }
chk('K0 夹具真实：贴纸在**池视图**里确实是令牌（原始库键保持内联＝#377/#455 的口径）；朋友圈配图种成令牌 ' + JSON.stringify(feedTok),
  pv.sticker.tok >= 4 && feedTok.got >= 2, { pv, feedTok });

let win = 0;
for (let i = 0; i < 30; i++) {
  win = await page.evaluate(() => document.querySelectorAll('#chat-body .msg-in .msg-av img').length);
  if (win > 10) break;
  await sleep(1500);
}
await page.bringToFront();
chk('G0 夹具真实：整窗气泡头像已排好，且屏外格子确实存在（否则「写入面」无从谈起）',
  win > 10 && win < 200, { win });

// ================= R 组：第二把写入面（四条触发路同一把尺子）=================
// 每轮先把存储值换成「与现值不同」的一张（#617 守卫：值没变＝DOM 一律不碰），再派发该路真实事件。
const TRIGGERS = [
  ['R-visibility', '回前台 visibilitychange（avatar-lib 的 convergeAvatars）', `
    window.xyStore(window.activePrefix()).set('cs-avatar-partner', nv);
    try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); } catch (e) {}
    document.dispatchEvent(new Event('visibilitychange'));
    try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); } catch (e) {}
    document.dispatchEvent(new Event('visibilitychange'));
    return true;`],
  ['R-fg-resume', 'mochi-fg-resume（#907 那一发回前台事件）', `
    window.xyStore(window.activePrefix()).set('cs-avatar-partner', nv);
    document.dispatchEvent(new Event('mochi-fg-resume'));
    return true;`],
  ['R-restore', 'mochi-restore-done（回填完成后强制收敛）', `
    window.xyStore(window.activePrefix()).set('cs-avatar-partner', nv);
    document.dispatchEvent(new Event('mochi-restore-done'));
    return true;`],
  ['R-settings', '聊天设置页那四处直接调的那把函数', `
    window.xyStore(window.activePrefix()).set('cs-avatar-partner', nv);
    if (window.refreshChatAvatars) window.refreshChatAvatars();
    return true;`],
];
const TRIGGER_SRC = Object.fromEntries(TRIGGERS.map(([k, , src]) => [k, src]));
async function bubbleRound(trigger, valIdx) {
  await page.bringToFront();
  let ready = 0;
  for (let i = 0; i < 12; i++) {
    ready = await page.evaluate(() => document.querySelectorAll('#chat-body .msg-in .msg-av img').length);
    if (ready > 10) break;
    await sleep(1200);
  }
  const nv = AV[(valIdx + 2) % AV.length];
  const visNow = await page.evaluate(() => {
    const box = document.getElementById('chat-body');
    const all = box ? [].slice.call(box.querySelectorAll('.msg-in .msg-av img')) : [];
    const vh = window.innerHeight || 0;
    return all.filter((im) => { const r = im.getBoundingClientRect(); return r.bottom > -80 && r.top < vh + 80; }).length;
  });
  await page.evaluate(() => window.__v1320.clr());
  // 节点身份打标：#617 的契约是「改值只改现有 img 的 src、不拆节点」——拆节点＝空一帧再从零解码，
  //   正是用户看见的「闪一下」。这一发之后还活着（带着标记）的节点数才说明写入面没换人。
  await page.evaluate(() => {
    let i = 0;
    document.querySelectorAll('#chat-body .msg-in .msg-av img').forEach((im) => { im.__m1320 = ++i; });
    return i;
  });
  const fired = await page.evaluate(({ src, nv }) => {
    try { return (new Function('nv', src))(nv); } catch (e) { return 'ERR: ' + e.message; }
  }, { src: TRIGGER_SRC[trigger], nv });
  if (String(fired).indexOf('ERR') === 0) console.log('  触发失败 ' + trigger + '：' + fired);
  let r = { writes: 0 };
  for (let i = 0; i < 22; i++) {
    await sleep(600);
    r = await page.evaluate(() => window.__v1320.bubble());
    if (r.offDone > 0 && r.visDone > 0 && i > 1) {
      const again = await page.evaluate(() => window.__v1320.w.filter((x) => x.kind === 'bubble').length);
      if (again === r.writes) break;
    }
  }
  r.replaced = await page.evaluate(() => {
    let gone = 0;
    document.querySelectorAll('#chat-body .msg-in .msg-av img').forEach((im) => { if (!im.__m1320) gone++; });
    return gone;
  });
  return { r, visNow, ready };
}

const R = {};
for (const [key, label, fn] of TRIGGERS) {
  let best = null;
  const attempts = [];
  for (let a = 0; a < 3; a++) {
    const one = await bubbleRound(key, a);
    attempts.push({ round: a + 1, ready: one.ready, visNow: one.visNow, writes: one.r.writes, uniq: one.r.uniq, visDone: one.r.visDone, offDone: one.r.offDone });
    best = { ...one.r, visNow: one.visNow };
    if (one.r.uniq >= 30 && one.r.visDone > 0 && one.r.offDone > 0) break;
  }
  R[key] = { best, attempts, label };
  console.log('[' + key + '] ' + JSON.stringify(best));
  chk(label + '：这一轮的写入面真被尺子数到（可见／屏外两档都有写入、去重节点 ≥30）——三轮都不构成照红判',
    best.uniq >= 30 && best.visDone > 0 && best.offDone > 0, { attempts, best });
  chk(label + '：可见的那几个排在整批写入最前面（第一个屏外写入的序号晚于最后一个可见写入）',
    best.offDone > 0 && best.firstOff > best.lastVis, best);
  chk(label + '：屏外那一批确实落在可见那一档之后的帧里（一次写完整窗＝帧号不可能更大）',
    best.offDone > 0 && best.minOffFr > best.maxVisFr, best);
  chk(label + '：可见的气泡头像一个都不许漏（分片不许把用户看得见的那几个推后）',
    best.visDone >= best.visNow && best.visNow > 0, best);
  chk(label + '：整窗刷新不许拆气泡节点（#617 契约＝改值只改现有 img 的 src；拆节点＝空一帧再从零解码＝用户看见的「闪一下」）',
    best.replaced === 0, best);
  const tok = await page.evaluate(() => window.__v1320.tokens());
  chk(label + '：这一路没有任何一次把令牌当 src 写过', tok.tokWrites === 0, { tokWrites: tok.tokWrites, stacks: tok.stacks });
}

// 值没变＝一次都不写（#617 守卫不许被本批改坏）＋ 连刷两轮旧分片作废
const sameVal = await (async () => {
  const cur = await page.evaluate(() => {
    const im = document.querySelector('#chat-body .msg-in .msg-av img');
    return im ? (window.xyStore(window.activePrefix()).get('cs-avatar-partner') || '') : '';
  });
  await page.evaluate(() => window.__v1320.clr());
  await page.evaluate((nv) => {
    window.xyStore(window.activePrefix()).set('cs-avatar-partner', nv);
    if (window.refreshChatAvatars) window.refreshChatAvatars();
    return true;
  }, cur);
  await sleep(2500);
  return page.evaluate(() => window.__v1320.bubble());
})();
chk('R6 值没变（同一发头像重复触发）＝整窗一次都不许写（#617 的守卫还在）', sameVal.writes === 0, sameVal);
const twoRounds = await (async () => {
  await page.evaluate(() => window.__v1320.clr());
  for (let i = 0; i < 2; i++) {
    await page.evaluate(({ nv }) => {
      window.xyStore(window.activePrefix()).set('cs-avatar-partner', nv);
      if (window.refreshChatAvatars) window.refreshChatAvatars();
      return true;
    }, { nv: AV[(4 + i) % AV.length] });
    await sleep(120); // 故意不给旧一轮分片跑完的机会：第二轮必须把第一轮剩下的作废
  }
  await sleep(6000);
  return page.evaluate(() => {
    const all = [].slice.call(document.querySelectorAll('#chat-body .msg-in .msg-av img'));
    const vals = {};
    for (const im of all) vals[(im.getAttribute('src') || '').slice(-24)] = (vals[(im.getAttribute('src') || '').slice(-24)] || 0) + 1;
    return { nodes: all.length, kinds: Object.keys(vals).length, vals: vals };
  });
})();
chk('R7 连着刷两轮：最终整窗只剩「最后一次」那一个值（旧轮次分片不许偷走新数据）', twoRounds.kinds <= 1, twoRounds);

// ================= K 组：全站「令牌当 src 写」穷举（真驱动每个入口，两条通道一起看）=================
// 只看「src 赋值探针」会漏一大片：多数列表是 innerHTML 带着 src 落地的＝赋值通道根本看不见那一档。
// 所以每个入口读两个事实：① 屏上此刻有没有格子以 @@m: 为 src（这才是用户可见的症状本体，两种落法都盖住）；
// ② 这一发期间赋值探针有没有数到令牌写（数到就按栈顶点名是谁写的）。
// 再加一条硬前置：该入口必须真渲染出 img——imgs:0 时「零令牌」是夹具没跑到，不是没症状，本组对这种入口
// 只报 SKIP、不报绿（#1314 那一族的假绿就是这么留下的）。
let skipped = 0;
async function drive(label, action, hostSel, settle = 4200) {
  await page.evaluate(() => window.__v1320.clr());
  const mark = tokReqAll.length;
  const info = await page.evaluate(action);
  await sleep(settle);
  const dom = await page.evaluate((sel) => {
    const scan = (one) => {
      const host = document.querySelector(one);
      const imgs = host ? [].slice.call(host.querySelectorAll('img')) : [];
      let tok = 0, pay = 0, ready = 0, unres = 0;
      for (const im of imgs) {
        const s = im.getAttribute('src') || '';
        if (s.indexOf('@@m:') === 0) tok++;
        else if (s.indexOf('data:') === 0) pay++;
        if (im.complete && im.naturalWidth > 0) ready++;
        if (im.classList && im.classList.contains('media-tok-missing')) unres++;
      }
      return { sel: one, imgs: imgs.length, tok, pay, ready, unres };
    };
    return sel.map(scan);
  }, hostSel);
  const tok = await page.evaluate(() => window.__v1320.tokens());
  tok.newReq = tokReqAll.length - mark;
  const totalImgs = dom.reduce((a, d) => a + d.imgs, 0), totalTok = dom.reduce((a, d) => a + d.tok, 0);
  console.log('[' + label + ']', JSON.stringify({ imgs: totalImgs, tokCells: totalTok, writes: tok.writes, tokWrites: tok.tokWrites, newReq: tok.newReq, dom: dom, rendered: info }));
  if (tok.tokWrites) console.log('   令牌落 src 的栈顶：' + JSON.stringify(tok.stacks).slice(0, 700));
  if (totalImgs === 0) { skipped++; console.log('  SKIP ' + label + '：这个入口一个 img 都没渲染出来＝夹具没跑到，不据此声称没症状也没声称修好'); return { skippedTrue: true }; }
  chk('K ' + label + '：屏上没有任何一格把 @@m: 令牌当 src 画着（用户可见的症状本体；img 总数 ' + totalImgs + '）', totalTok === 0, { dom, tokWrites: tok.tokWrites });
  chk('K ' + label + '：赋值通道也没有一次写令牌（有则栈顶点名）', tok.tokWrites === 0, { stacks: tok.stacks });
  chk('K ' + label + '：内核没有为令牌真发过一次相对 URL 请求', tok.newReq === 0, { newReq: tok.newReq, sample: tokReqAll.slice(-2) });
  return { totalImgs, totalTok, tok };
}
const K = {};
K.chat = await drive('聊天页整窗（气泡与卡片图，含 #chat-body）', () => {
  try { window.enterChat(); } catch (e) {}
  const b = document.getElementById('chat-emoji-btn');
  return { chat: !!b };
}, ['#chat-body'], 5000);
K.emoji = await drive('表情面板（#1314 已收那一路，本批不许打回）', () => {
  const b = document.getElementById('chat-emoji-btn'); if (b) b.click();
  return { btn: !!b };
}, ['#emoji-list'], 4500);
await page.evaluate(() => { if (window.closeEmojiPanelForInsert) window.closeEmojiPanelForInsert(); return true; });
K.chatcard = await drive('字卡库各分类（chatcard 的懒加载泵＋无 IO 的即时补＋预览大图）', async () => {
  const t = document.querySelector('.tab[data-page="page-chatcard"]'); if (t) t.click();
  await new Promise((r) => setTimeout(r, 2600));
  const tabs = [].slice.call(document.querySelectorAll('#cc-tabs .cc-tab'));
  for (const x of tabs) { try { x.click(); } catch (e) {} await new Promise((r) => setTimeout(r, 1500)); }
  return { tab: !!t, cats: tabs.length };
}, ['#cc-list', '#page-chatcard'], 3000);
K.avlib = await drive('头像库（#1314 已收那一路，本批不许打回）', () => {
  try { window.openAvlib(); } catch (e) {}
  return { opened: !!document.getElementById('avlib-grid') };
}, ['#avlib-grid'], 3500);
await page.evaluate(() => { try { window.closeAvlib(); } catch (e) {} return true; });
K.group = await drive('群聊（group-chat 的贴纸／图片气泡，自己也走 mochiMediaTokenize）', async () => {
  const tp = document.querySelector('.tab[data-page="page-phone"]'); if (tp) tp.click();
  await new Promise((r) => setTimeout(r, 1200));
  const a = document.querySelector('.app[data-app="group-chat"]'); if (a) a.click();
  await new Promise((r) => setTimeout(r, 4000));
  return { entry: !!a };
}, ['#page-group-chat'], 3500);
K.feed = await drive('朋友圈（feed 的时间线配图与封面，自己也走 mochiMediaTokenize）', async () => {
  const tp = document.querySelector('.tab[data-page="page-phone"]'); if (tp) tp.click();
  await new Promise((r) => setTimeout(r, 1200));
  const a = document.querySelector('.app[data-app="feed"]'); if (a) a.click();
  await new Promise((r) => setTimeout(r, 4000));
  return { entry: !!a };
}, ['#page-feed', '#page-feed-all'], 3500);
chk('K8 全程零「为令牌发的相对 URL 请求」（内核真发出去过就算）', tokReqAll.length === 0, { total: tokReqAll.length, sample: tokReqAll.slice(0, 3) });
chk('Z1 全程零未捕获异常', jsErrs.length === 0, { jsErrs: jsErrs.slice(0, 5) });

console.log('\n结果: 绿 ' + pass + ' / 红 ' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
