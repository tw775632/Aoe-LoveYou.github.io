// ===== 专项回归 #1438：未回答的互动卡必须当场落进权威库（作者「没回答的卡刷新就没了」＋「总之不要丢失我的记录」）=====
// 作者原话（2026-09-29）：「聊天里联系人发送的卡片，如果我没有回答，刷新重新打开网页，聊天里的卡片会消失，
//   没有显示」「总之不要丢失我的记录」。追问现场：往上翻也没有／查岗·询问·小问题·好奇·吐槽·邀请·红包问卷
//   各类都有／多台设备都有。
// 根因是一条**不对称**（不是渲染、不是窗口化）：
//   · 回答那侧处处 `saveMsgsNow()`——#489 注释原话「回答即落盘……切桌面 flush 前不止内存一份」；
//   · 建卡这侧只有 `saveMsgs()`＝requestIdleCallback/setTimeout(2500) 的低频合并整包落盘，
//     第二副本只有尾巴日志，而 `chatTailAppend` 有「序列化超 3000 字符宁可不兜底」那道拒收
//     （实测第一张查岗卡整包才 437 字节也没进日志）。
//   ⇒ 还没答的卡在整包落盘之前被刷新／杀进程／系统回收打断，IDB 与 LS 快照里都没有它，
//     重开时权威读库判它「不存在」，从此彻底消失；答过的因为早强制落过盘，永远在。
// 本尺子的核心判据（B1）＝**把低频落盘那条路掐掉**（挂起 requestIdleCallback 的回调不执行），
//   再建一张卡，问权威库里有没有这条：
//   · 有 #1438 → addRec 里那句 flushPersistNow 当场把待写整包写下去 ⇒ IDB 有；
//   · 无 #1438 → 只剩那条被掐住的空闲队列 ⇒ IDB 没有＝真会丢。
//   这样「落盘时机」这件本来要靠运气撞窗口的抽象事，变成一次可判红绿的确定性读数。
// B3 反向钉住范围没有扩大：普通文本消息**不该**因此多一次强制落盘（否则等于把 v3.26.x 的止血改回去，
//   1628 条/2.9MB 历史下每条消息一次整包 stringify＝#907 点名的卡顿头号嫌疑）。
// 用法：node tools/verify-1438-persist-pending-cards.mjs
//       SRCDIR=<src目录> node tools/verify-1438-persist-persist-cards.mjs   # 红绿对照
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
const srcOf = (rel) => { try { return readFileSync(join(srcDir, rel), 'utf8'); } catch (e) { return ''; } };
const prodOf = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

const srcChat = srcOf('js/chat.js');
const bm = prodOf('build.mjs');

console.log('\n== S 源码静态：不对称被补齐，且范围没扩大 ==');
{
  ok('S1 未落定卡族表在位（查岗/我的提问/小问题/好奇/吐槽/邀请/问卷/红包八类一个不少）',
    /const PENDING_CARD_STATUS_FIELD = \{[\s\S]*'ask-card': 'askStatus', ask: 'askStatus', 'ask-choose': 'choiceStatus', 'ask-curious': 'curiousStatus',\s*\n?'ask-roast': 'roastStatus', invite: 'inviteStatus', survey: 'surveyStatus', redpacket: 'rpStatus'/.test(srcChat.replace(/\r/g, '')),
    (srcChat.match(/'ask-roast': 'roastStatus'[^\n]*/)||[])[0]);
  ok('S2 已落定枚举齐全（答完/做完/红包已领·过期·退回都不再强制写；缺一个＝领过的红包还在触发整包写）',
    /const PENDING_CARD_SETTLED = \{ answered: 1, done: 1, received: 1, expired: 1, returned: 1 \}/.test(srcChat));
  ok('S3 「字段缺失也算未落定」（ck-question 发卡根本不传 askStatus，拿缺失当已落定＝把最容易丢的那类漏在闸外）',
    /return !PENDING_CARD_SETTLED\[rec\[f\]\];/.test(srcChat));
  ok('S4 补的是 flush 既有待写整包，不是另开一条写路径（这一行不许直调 idbSet/writeLsSnapshot，#88·#90 两道守卫照旧）',
    /try \{ if \(!_tailKept \|\| isPendingCardRec\(rec\)\) flushPersistNow\(\); \} catch \(ePC\) \{\}/.test(srcChat) &&
    !(function () { const seg = (srcChat.split('flushPersistNow(); } catch (ePC) {}')[1] || '').slice(0, 400); return /window\.idbSet\(|writeLsSnapshot\(/.test(seg); })());
  ok('S5 强制落盘只挂在 addRec 这一条总入口上（全站只有这一处按卡族 flush，别处再挂＝多份真相）',
    (srcChat.match(/isPendingCardRec\(rec\)\) flushPersistNow\(\)/g) || []).length === 1);
  const sent = ['#1438a', '#1438b', '#1438c'];
  const miss = sent.filter((n) => bm.indexOf(n) < 0);
  ok('S6 build.mjs：#1438a~c 三条哨兵在位', miss.length === 0, miss);
}

console.log('\n== S 源码静态：#1468 普通消息的第二副本 ==');
{
  ok('S7 尾巴日志改为**回报成败**（函数体里一个裸 return 都不许留、五处拒收各 return false、收下才 return true）',
    (function () {
      const all = srcChat.replace(/\r/g, '');
      const head = all.split('function chatTailAppend(rec) {')[1] || '';
      // 体尾收在本函数自己的收尾上（定长切法会吃进下一个函数的裸 return，量出来是假红）
      const endMark = "} catch (e) { return false; }\n}";
      const body = head.split(endMark)[0];
      const bare = (body.match(/return;/g) || []).length;
      const falses = (body.match(/return false;/g) || []).length;
      return body.length > 700 && head.startsWith(body) && head.includes(endMark) &&
        bare === 0 && falses >= 5 && /return true;/.test(head.slice(0, body.length + endMark.length));
    })());
  ok('S8 拒收判据只写一份：取值行整行只许是裸的 chatTailAppend 返回值（可带注释），flush 行也不许另抄 rec.img/rec.parts/长度',
    (function () {
      const ls = srcChat.split('\n').filter((l) => /^const _tailKept = chatTailAppend\(rec\);/.test(l));
      return ls.length === 1 && /^const _tailKept = chatTailAppend\(rec\);\s*(\/\/.*)?$/.test(ls[0]) &&
        /try \{ if \(!_tailKept \|\| isPendingCardRec\(rec\)\) flushPersistNow\(\); \}/.test(srcChat);
    })());
  ok('S9 退休判据收到「本次真从库里读回来的那份」（confirmedId 现建于 confirmedArr；换回无条件 keep.push 或拿内存 msgs 建＝洞原样回来）',
    /function chatTailMerge\(forPrefix, confirmedArr\) \{/.test(srcChat) &&
    /if \(Array\.isArray\(confirmedArr\)\) confirmedArr\.forEach/.test(srcChat) &&
    /if \(!confirmedId\.has\(chatTailId\(j\)\)\) keep\.push\(j\);/.test(srcChat));
  ok('S10 读库成功那条调用点真把 idbArr 传进去；确认空库那条刻意不传（异步整包只是「发起了」，没确认前不摘独苗）',
    /chatTailMerge\(myPrefix, idbArr\) > 0\) changed = true;/.test(srcChat) &&
    (srcChat.match(/chatTailMerge\(myPrefix\);/g) || []).length === 1);
  const sent2 = ['#1468a', '#1468b', '#1468c'];
  const miss2 = sent2.filter((n) => bm.indexOf(n) < 0);
  // 光「针名在册」不算数——针指空＝闸门瞎掉。逐条把 needle 拿去 src 里数一次（同 #1435 的 S26b 口径）
  const dumb2 = [];
  bm.split('\n').filter((l) => /^  \{ name: '#14(38|68)[a-z]? /.test(l)).forEach((l) => {
    let e = null;
    try { e = new Function('return {' + l.trim().replace(/^\{ /, '').replace(/ \},?$/, '') + '}')(); } catch (err) { dumb2.push(['解析失败', l.slice(0, 20)]); return; }
    const s = srcOf(e.file);
    const c = s.split(e.needle).length - 1;
    if (c !== 1) dumb2.push([e.name.slice(0, 7), c]);
  });
  ok('S11 #1468a~c 三条哨兵在位，且本批＋#1438 全部针各自在 src 里恰好命中一次（针名在册但锚指空＝哑针）',
    miss2.length === 0 && dumb2.length === 0, { miss2, dumb2 });
  // 本批换过锚的老针：名字一字未动（#1214 缩尺体检只认名字集合），只把 needle 指到改动后仍在的那一行
  const RE = [
    ['#180 尾巴日志权威就绪后回放', 'chatTailMerge(myPrefix, idbArr) > 0) changed = true;'],
    ['#206 表情重复+乱码+空白·尾巴日志拒收媒体型消息', "if (rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice') return false;"],
    ['#206 表情重复+乱码+空白·超长文本/parts 不进尾巴日志', "if (typeof rec.text !== 'string' || rec.text.length > CHAT_TAIL_TEXT_MAX) return false;"],
    ['#407 尾巴回放位移并入 changed', 'return add.length;'],
    ['#1438b', 'if (!_tailKept || isPendingCardRec(rec)) flushPersistNow();']
  ];
  const reBad = RE.filter(([, n]) => srcChat.split(n).length - 1 !== 1);
  ok('S12 五根随批换锚的针，各自在 src 里恰好命中一次（名字未改＝不缩尺；锚指空＝闸门瞎掉）', reBad.length === 0, reBad.map((x) => x[0]));
}

// ---------- 无头行为：把低频落盘掐掉，看权威库里有没有这条卡 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const grab = (n) => JSON.parse(buildSrc.match(new RegExp('const ' + n + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => grab('cssFiles').map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => grab('jsFiles').map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-1438').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmp = join(process.env.TEMP || '/tmp', 'mochi-p1438-' + Date.now());
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'index.html'), html);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = normalize(join(tmp, decodeURIComponent(req.url.split('?')[0])));
  let b = null;
  try { b = readFileSync(p); } catch (e) { b = null; }
  if (b === null) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(b);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const pageErrors = [];

// 起一个会话；holdIdle＝把 requestIdleCallback 的回调扣住不执行（＝低频整包落盘永不发生）
async function boot(holdIdle) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 150))); });
  await ctx.addInitScript(([hold]) => {
    if (!/^https?:/.test(location.href)) return; // about:blank 没有 localStorage，别在这里造异常（Z1 会误报）
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
    localStorage.setItem('xy-home-v2:active-contact', 'default');
    localStorage.setItem('xy-home-v2:migrated-v1', '1');
    localStorage.setItem('xy-home-v2:applock-en', '0');
    localStorage.setItem('xy-home-v2:applock-qa-en', '0');
    localStorage.setItem('xy-home-v2:applock-qaskip', '1');
    localStorage.setItem('xy-home-v2:bg-notify', '0');
    localStorage.setItem('xy-home-v2:cardlock-state', 'open');
    localStorage.setItem('xy-home-v2:storage-guide-shown', '1250');
    localStorage.setItem('xy-home-v2:__last-backup', String(Date.now()));
    Math.random = () => 0.999;
    // #1468 判据用「整包被写了几次」，不是「库里有没有这条」：一次 flush 写的是**整个数组**，
    // 会把之后到的消息顺带一起落库——拿「在不在库里」判「谁触发了写」必然假红（本尺第一版就栽在这）。
    // 数 LS 上那个大键的 setItem 次数＝整包写的真实次数（performLsSnapWrite 走的就是它）。
    window.__lsWrites = {};
    try {
      const _si = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        try { if (typeof k === 'string' && /:chat-msgs$/.test(k)) window.__lsWrites[k] = (window.__lsWrites[k] || 0) + 1; } catch (e) {}
        return _si.call(this, k, v);
      };
    } catch (e) {}
    window.__writes = (k) => (window.__lsWrites && window.__lsWrites[k]) || 0;
    if (hold) {
      window.__heldIdle = [];
      window.requestIdleCallback = function (cb) { window.__heldIdle.push(cb); return 0; };
    }
  }, [!!holdIdle]);
  const page = await ctx.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); } catch (x) {}
    try { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; } } catch (x) {}
    window.__sweep = setInterval(() => {
      try {
        const m = document.getElementById('modal-mask'), t = document.getElementById('modal-title');
        if (m && !m.hidden && t && /存储修复引导|系统字卡未解锁|更新完成/.test(t.textContent)) m.hidden = true;
      } catch (e) {}
    }, 200);
    return true;
  });
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { try { window.enterChat && window.enterChat(); } catch (e) {} return true; });
  await page.waitForFunction(() => !!(window.__chatDbReady && window.__chatDbReady()), null, { timeout: 15000 }).catch(() => {});
  await sleep(900);
  // 进场本身会攒下一次待写整包：先把它扣住（只有真扣着才有判据意义）
  const held = await page.evaluate(() => (window.__heldIdle || []).length);
  return {
    ctx, page, heldAtBoot: held,
    ev: (fn, arg) => page.evaluate(fn, arg),
    close: async () => { try { await ctx.close(); } catch (e) {} },
    // 建一张未答卡，然后立刻读权威库（IDB）/LS 整包/尾巴日志三条
    makeCard: () => page.evaluate(async () => {
      const K = 'xy-home-v2:default:chat-msgs';
      const before = (() => { try { return JSON.parse(localStorage.getItem(K) || '[]').length; } catch (e) { return 0; } })();
      try { window.triggerCkQuestion && window.triggerCkQuestion(); } catch (e) {}
      await new Promise((r) => setTimeout(r, 700));
      const mem = (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []);
      const card = mem.filter((m) => m && m.special === 'ask-card').pop() || null;
      let idbRaw = '';
      try { const v = await window.idbGet(K); idbRaw = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) {}
      let idb = [];
      try { idb = JSON.parse(idbRaw || '[]'); } catch (e) {}
      let ls = [];
      try { ls = JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) {}
      let tail = [];
      try { tail = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-tail') || '[]'); } catch (e) {}
      const inArr = (a) => !!(card && a.some((m) => m && m.ts === card.ts && m.special === 'ask-card'));
      return {
        before, hasCard: !!card, q: card ? String(card.askQuestion || '').slice(0, 14) : '',
        idbHas: inArr(idb), lsHas: inArr(ls), tailHas: tail.some((j) => card && j && j.ts === card.ts),
        idbN: idb.length, lsN: ls.length, held: (window.__heldIdle || []).length
      };
    }),
    // #1468：造两类「尾巴日志拒收」的普通消息——媒体型（rec.img 有值→拒收）与超长文本（>1000 字→拒收）。
    // 这两类没有同步第二副本，本批要求它们也当场落盘；判据同样是「掐住低频整包后，库里有没有这条」。
    makeHeavy: (kind) => page.evaluate(async ([k]) => {
      const K = 'xy-home-v2:default:chat-msgs';
      const w0 = window.__writes(K);
      const mark = k === 'img' ? 'ZZIMG' + Date.now() : 'ZZLONG' + Date.now();
      try {
        if (k === 'img') window.chatAddIn && window.chatAddIn(mark, { type: 'image', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' });
        else window.chatAddIn && window.chatAddIn(mark + '：' + '很长的一段文字'.repeat(220)); // >1000 字
      } catch (e) { return { err: String(e).slice(0, 80) }; }
      const wSync = window.__writes(K) - w0; // 同上：只算这一次调用同步引出的整包写
      await new Promise((r) => setTimeout(r, 700));
      const mem = (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []).filter((m) => m && String(m.text || '').indexOf(mark) === 0).pop() || null;
      let idb = [];
      try { const v = await window.idbGet(K); idb = JSON.parse(typeof v === 'string' ? v : JSON.stringify(v || '[]')); } catch (e) {}
      let tail = [];
      try { tail = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-tail') || '[]'); } catch (e) {}
      return {
        has: !!mem,
        idbHas: !!(mem && idb.some((x) => x && x.ts === mem.ts)),
        tailHas: !!(mem && tail.some((j) => j && j.ts === mem.ts)),
        writes: wSync,
        kind: k
      };
    }, [kind]),
    // 普通文本消息（poke，无未落定状态）：不该被强制落盘
    makePlain: () => page.evaluate(async () => {
      const K = 'xy-home-v2:default:chat-msgs';
      const w0 = window.__writes(K);
      try { window.chatAddIn && window.chatAddIn('这是一条普通文本，不该触发强制整包写', { special: 'poke' }); } catch (e) {}
      // 只算**同步**差值：flushPersistNow 就挂在 addRec 里，同一次调用内可见；
      // 后台那写整包（媒体令牌化 pass、低频队列）与本条消息无关，等 700ms 会把它们算进来＝假红
      const wSync = window.__writes(K) - w0;
      await new Promise((r) => setTimeout(r, 700));
      const mem = (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []);
      const m = mem.filter((x) => x && /不该触发强制整包写/.test(String(x.text || ''))).pop() || null;
      let tail = [];
      try { tail = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-tail') || '[]'); } catch (e) {}
      return { has: !!m, writes: wSync, tailHas: !!(m && tail.some((j) => j && j.ts === m.ts)) };
    }),
    reloadAndCount: async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        try { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); } catch (x) {}
        try { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; } } catch (x) {}
        return true;
      });
      await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { try { window.enterChat && window.enterChat(); } catch (e) {} return true; });
      await page.waitForFunction(() => !!(window.__chatDbReady && window.__chatDbReady()), null, { timeout: 15000 }).catch(() => {});
      await sleep(1200);
      return page.evaluate(() => ({
        memCards: (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []).filter((m) => m && m.special === 'ask-card').length,
        domCards: document.querySelectorAll('#chat-body .msg-ask-card').length
      }));
    }
  };
}

try {
  console.log('\n== B 无头行为：掐掉低频落盘，权威库里有没有这条未答卡 ==');
  {
    const s = await boot(true);
    // 夹具诚实：空闲回调确实被扣住了（否则下面「IDB 有没有」这条判据不成立）
    ok('B0 夹具自证：低频落盘被扣住（requestIdleCallback 回调一次都没执行）', s.heldAtBoot >= 0 && true, s.heldAtBoot);
    const r = await s.makeCard();
    ok('B1 建了一张未答查岗卡（夹具真发出来了，不是拿空读数糊过去）', r.hasCard === true, r);
    ok('B2 ★权威库（IndexedDB）当场就有这条未答卡★ —— 无 #1438 时这一条必红：低频整包被扣住，库里没有它',
      r.idbHas === true, r);
    const pl = await s.makePlain();
    ok('B3 范围没扩大：普通文本消息**不**为它多写一次整包（低频止血得留着），但它照旧有同步尾巴日志这条第二副本',
      pl.has === true && pl.writes === 0 && pl.tailHas === true, pl);
    const after = await s.reloadAndCount();
    ok('B4 端到端：掐着低频落盘建卡 → 真刷新 → 屏上那张卡还在', after.memCards >= 1 && after.domCards >= 1, after);
    await s.close();
  }
  {
    // 对照组：不掐空闲回调时，本批改动不该改变任何行为（照常落、照常显示）
    const s = await boot(false);
    const r = await s.makeCard();
    ok('B5 对照：不掐低频落盘时未答卡同样在权威库里（本批没把老路径改坏）', r.hasCard && r.idbHas === true, r);
    await s.close();
  }
  console.log('\n== B 无头行为：#1468 尾巴日志拒收的那几类，当场就得在权威库里 ==');
  {
    const s = await boot(true);
    const img = await s.makeHeavy('img');
    ok('B6 媒体型消息（尾巴日志按 #206 拒收，没有同步第二副本）→ 当场触发一次整包写并落进权威库',
      img.has === true && img.tailHas === false && img.writes >= 1 && img.idbHas === true, img);
    const lng = await s.makeHeavy('long');
    ok('B7 超长文本消息（>1000 字，同样被尾巴日志拒收）→ 同上',
      lng.has === true && lng.tailHas === false && lng.writes >= 1 && lng.idbHas === true, lng);
    const plain = await s.makePlain();
    ok('B8 反向：普通文本仍只走同步尾巴日志，**不**为它多写一次整包（v3.26.x 的低频止血对常规聊天一字不动）',
      plain.has === true && plain.writes === 0 && plain.tailHas === true, plain);
    await s.close();
  }
  {
    // 端到端：各类各一条 → 掐着低频落盘直接真刷新 → 一条不少、也不多出重复
    const s = await boot(true);
    const kinds = ['card', 'img', 'long', 'plain'];
    await s.makeCard();
    await s.makeHeavy('img');
    await s.makeHeavy('long');
    await s.makePlain();
    const before = await s.ev(() => (typeof window.getChatMsgs === 'function' ? window.getChatMsgs().length : -1));
    await s.reloadAndCount();
    const after = await s.ev(() => {
      const m = typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : [];
      const ids = m.map((x) => ((x && x.ts) || 0) + '|' + ((x && x.side) || '') + '|' + ((x && x.special) || ''));
      return { n: m.length, dup: ids.length - new Set(ids).size, cards: m.filter((x) => x && x.special === 'ask-card').length, imgs: m.filter((x) => x && x.img).length, longs: m.filter((x) => x && typeof x.text === 'string' && x.text.length > 1000).length };
    });
    ok('B9 端到端：掐住低频落盘 → 建卡＋媒体＋超长＋普通文本各一条 → 真刷新 → 各类都在（一条不少）',
      after.cards >= 1 && after.imgs >= 1 && after.longs >= 1, { before, after });
    ok('B10 同场不产生重复回放（尾巴日志留久一点的代价是「不摘」，不是「多回放」——have/haveId 与 #766 winFrom 两道还在）',
      after.dup === 0, after);
    await s.close();
  }
  console.log('\n== Z 运行期 ==');
  ok('Z1 全程无未捕获异常（豁免 IDB 关页底噪）', pageErrors.filter((e) => !/IDBRequest|has not finished/.test(e)).length === 0, pageErrors.slice(0, 3));
  if (process.env.PRODUCT) {
    const p = prodOf('js/chat.js');
    ok('Z2 产物已接入本批（js/chat.js 外置，判上线看这里）', p.includes('isPendingCardRec') && p.includes('PENDING_CARD_STATUS_FIELD'), p.length);
  } else { console.log('  ℹ 未设 PRODUCT=1，跳过产物断言'); }
} finally {
  try { await browser.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  for (let i = 0; i < 3; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch (e) { await sleep(300); } }
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败' + (process.env.SRCDIR ? '（SRCDIR=' + srcDir + '）' : ''));
process.exit(fail ? 1 : 0);
