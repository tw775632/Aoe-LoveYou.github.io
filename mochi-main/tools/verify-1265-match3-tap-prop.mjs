// ===== #1265 消消乐道具模式「点道具格＝立刻引爆」行为断言 =====
// 用户直派：「消消乐的道具模式的道具不能直接使用」。取证：#453 起道具只有「交换进三连」一条引爆路，
// 点道具格只会被选中（再点一下取消选中）＝零反应，开局说明甚至明写「不是点一下就用」——
// 用户读到的正是「不能直接使用」。本脚本按用户视角（真 click 棋盘格子）断言：
//   S 源码接线四枚（点击入口 / 已选中再点 / 引爆门控 / doSwap 与点击共用结算链）
//   B 四种道具点下去真引爆：↔️ 清整行、↕️ 清整列、💥 炸 3×3（扫中另一道具连锁引爆）、🌈 清光一色；
//     引爆当场消耗本回合（立刻 lock、结算完 turn=2），且直接引爆不再生成新道具
//   C 交换引爆照旧（↕️ 交换进三连仍清整列）、道具模式四连仍生成 ↔️、无效交换仍回弹
//   N 不误伤：简单模式点道具不引爆、点普通格仍是选中、TA 回合点道具无效、道具模式下选普通格
//     再点相邻道具＝走交换（不被引爆劫持）
//   Z 全程零未捕获页面错误
// 用法：node tools/verify-1265-match3-tap-prop.mjs（内存拼装 src，不依赖构建产物；A/B 基线在仓外副本跑同一份）
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, normalize, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcMatch3 = readFileSync(join(root, 'src/js/match3.js'), 'utf8');

// —— 与 build.mjs 同序内存拼装（不写产物）——
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => {
  const code = readFileSync(join(root, 'src/js/' + f), 'utf8');
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} } })();';
}).join('\n');
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');
const tmpPage = join(tmpdir(), 'mochi-m3-tap-prop-' + Date.now() + '.html');
writeFileSync(tmpPage, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
// 条纹底板 (r*3+c)%6：自身无任何三连，盘面出现的道具全是本批埋进去的那几颗
async function setGrid(overlay, patch) {
  await page.evaluate(([ov, pt]) => {
    const d = window.__m3Debug, s = d.st();
    const g = [];
    for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push((r * 3 + c) % 6); g.push(row); }
    (ov || []).forEach((p) => { g[p[0]][p[1]] = p[2]; });
    s.grid = g;
    s.sel = null; s.lock = false; s.over = false; s.started = true; s.turn = 1;
    s.score = 0; s.myScore = 0; s.taScore = 0; s.genSpecial = null; s.misPicks = 0;
    s.target = 999999;   // 防单发大消除误触结算
    Object.assign(s, pt || {});
  }, [overlay, patch || null]);
}
function maxSpecial(grid) {
  let m = 0;
  (grid || []).forEach((row) => row.forEach((v) => { if (v >= 10 && v > m) m = v; }));
  return m;
}
// 真点棋盘格：click 后立刻读同帧状态（lock/sel），再用 1ms 轮询抓结算完成那一瞬的快照
// （快照必须早于 TA 的 45~85ms 定时器，否则「turn=2」「盘面零道具」两断言会被 TA 那一步污染）
async function tapTile(r, c) {
  return page.evaluate(([tr, tc]) => new Promise((res) => {
    const d = window.__m3Debug;
    let el = null;
    document.querySelectorAll('#m3-board .m3-tile').forEach((t) => { if (!el && t._r === tr && t._c === tc) el = t; });
    if (!el) { res({ missing: true }); return; }
    const s0 = d.st();
    const score0 = s0.score, my0 = s0.myScore;
    el.click();
    const s1 = d.st();
    const now = { lock: s1.lock === true, sel: s1.sel ? s1.sel.slice() : null };
    let ticks = 0;
    const t = setInterval(() => {
      const s = d.st();
      if (++ticks > 6000 || !s) { clearInterval(t); res({ timeout: true, now }); return; }
      if (s.lock) return;
      clearInterval(t);
      res({
        missing: false, now,
        gain: s.score - score0, myGain: s.myScore - my0,
        turn: s.turn, grid: s.grid.map((row) => row.slice()), gen: s.genSpecial,
        selAfter: s.sel ? s.sel.slice() : null
      });
    }, 1);
  }), [r, c]);
}
async function swap(a, b, overlay, patch) {
  await setGrid(overlay, patch);
  return page.evaluate(([pa, pb]) => new Promise((res) => {
    const d = window.__m3Debug;
    const s0 = d.st(); const score0 = s0.score;
    window.__m3Last = null;
    d.doSwap(pa, pb, true, (ok) => { window.__m3Last = { ok: ok, gain: d.st().score - score0 }; });
    let ticks = 0;
    const t = setInterval(() => {
      const s = d.st();
      if (++ticks > 6000 || !s) { clearInterval(t); res({ timeout: true }); return; }
      if (!window.__m3Last || s.lock) return;
      clearInterval(t);
      res({ last: window.__m3Last, gain: s.score - score0, grid: s.grid.map((row) => row.slice()), gen: s.genSpecial, turn: s.turn });
    }, 1);
  }), [a, b]);
}

await page.goto('file://' + tmpPage);
try {
  await page.waitForFunction(() => typeof window.openMatch3Panel === 'function', null, { timeout: 20000 });
} catch (e) {
  const probe = await page.evaluate(() => ({ m3: typeof window.__m3Debug, panelHidden: (document.getElementById('chat-match3-panel') || {}).hidden })).catch(() => ({}));
  console.error('拼装页加载失败：', JSON.stringify(probe), '\npageerrors:', errors.slice(0, 5).join(' | '));
  await browser.close();
  try { unlinkSync(tmpPage); } catch (e2) {}
  process.exit(1);
}
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) { s.classList.add('hide'); s.hidden = true; }
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); });
  window.openMatch3Panel();
  document.getElementById('chat-match3-panel').hidden = false;
  window.__m3Debug.fast = true;
  document.getElementById('m3-mode').value = 'item';
});
await page.evaluate(() => window.__m3Debug.newGame());
await page.waitForFunction(() => window.__m3Debug.st() && window.__m3Debug.st().started && !window.__m3Debug.st().lock, null, { timeout: 8000 });

// ---- S 源码接线（红基线＝#1265 之前那份 match3.js 四处全缺）----
check('S1 引爆入口存在（点道具格调 playerUseProp）', /propKind\(st\.grid\[r\]\[c\]\) && playerUseProp\(r, c\)/.test(srcMatch3));
check('S2 已选中的道具格再点一下也引爆', /if \(playerUseProp\(r, c\)\) return;/.test(srcMatch3));
check('S3 引爆门控＝玩家回合＋道具模式', /st\.turn !== 1 \|\| st\.mode !== 'item'\) return false;/.test(srcMatch3));
check('S4 点击与交换共用结算链（doSwap 改调 clearCascade）', /function clearCascade\(s, seeds, at, byMe, cb, revert\) \{/.test(srcMatch3) && /clearCascade\(s, null, b, byMe, cb/.test(srcMatch3));
check('S5 开局说明改口成「点它就引爆」（旧文案「不是点一下就用」正是本症状本体）', /直接点它就引爆/.test(srcMatch3) && !/不是点一下就用/.test(srcMatch3));

// ---- B 四种道具点下去真引爆 ----
const dbg = await page.evaluate(() => {
  const d = window.__m3Debug;
  return { LINE_H: d.LINE_H, LINE_V: d.LINE_V, BOMB: d.BOMB_BASE, RAINBOW: d.RAINBOW, has: typeof d.playerUseProp === 'function' };
});
check('B0 调试口已带 playerUseProp（缺＝旧产物/旧 src，下面行为断言无从谈起）', dbg.has);

await setGrid([[2, 3, dbg.LINE_H]]);
const bH = await tapTile(2, 3);
check('B1 点 ↔️ 立刻引爆＝当场清整行（gain≥8）且道具从盘面消失', !bH.missing && bH.gain >= 8 && maxSpecial(bH.grid) === 0, JSON.stringify({ gain: bH.gain, max: maxSpecial(bH.grid) }));
check('B1b 引爆消耗本回合（同帧 lock=true、结算完 turn=2）', bH.now && bH.now.lock === true && bH.turn === 2, JSON.stringify({ now: bH.now, turn: bH.turn }));
check('B1c 引爆的分记在「你」这一侧', bH.myGain === bH.gain && bH.gain > 0, 'myGain=' + bH.myGain + ' gain=' + bH.gain);
check('B1d 引爆后不再要求选中（旧写法：点一下只是把格子标上 m3-sel）', bH.selAfter === null, JSON.stringify(bH.selAfter));

await setGrid([[2, 3, dbg.LINE_V]]);
const bV = await tapTile(2, 3);
check('B2 点 ↕️ 立刻引爆＝清整列（gain≥8）', !bV.missing && bV.gain >= 8 && maxSpecial(bV.grid) === 0, 'gain=' + bV.gain);

await setGrid([[2, 2, dbg.BOMB]]);
const bB = await tapTile(2, 2);
check('B3 点 💥 立刻引爆＝周围 3×3（gain≥9）', !bB.missing && bB.gain >= 9 && maxSpecial(bB.grid) === 0, 'gain=' + bB.gain);

await setGrid([[2, 2, dbg.BOMB], [2, 3, dbg.LINE_H]]);
const bC = await tapTile(2, 2);
check('B3b 炸弹炸到旁边的 ↔️＝连锁引爆（9+5=14 格起）', !bC.missing && bC.gain >= 14 && maxSpecial(bC.grid) === 0, 'gain=' + bC.gain);

// 条纹板每色 64/6≈10 颗：彩虹至少清掉「场上最少那一色」＋彩虹自身
const rainbowMin = await page.evaluate(() => {
  const g = [];
  for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push((r * 3 + c) % 6); g.push(row); }
  const cnt = {};
  g.forEach((row) => row.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; }));
  return Math.min.apply(null, Object.keys(cnt).map((k) => cnt[k])) + 1;
});
await setGrid([[4, 4, dbg.RAINBOW]]);
const bR = await tapTile(4, 4);
check('B4 点 🌈 立刻引爆＝清光一种颜色（gain≥' + rainbowMin + '）', !bR.missing && bR.gain >= rainbowMin && maxSpecial(bR.grid) === 0, 'gain=' + bR.gain + ' need>=' + rainbowMin);

await setGrid([[2, 3, dbg.LINE_H]]);
const bN = await tapTile(2, 3);
check('B5 引爆那一格当场不再处于「选中」态（旧写法是把它标上 m3-sel 等下一步）', bN.now && bN.now.lock === true && bN.now.sel === null, JSON.stringify(bN.now));

// ---- C 交换引爆照旧（重构没把旧那条路改坏）----
const c1 = await swap([3, 1], [4, 1], [[4, 0, 2], [4, 2, 2], [4, 3, 2], [3, 1, 2]]);
check('C1 道具模式横四连交换仍生成 ↔️（结算链抽取后生成分档未变）', c1.last && c1.last.ok === true && c1.gen === 'line-h', 'gen=' + c1.gen);
const c2 = await swap([2, 3], [3, 3], [[2, 3, dbg.LINE_V + 1], [3, 2, 1], [3, 4, 1]]);
check('C2 ↕️ 交换进三连仍照常引爆（旧那条路一字未动：三连＝横向 3 格＋整列 8 格）', !!c2.last && c2.last.ok === true && c2.gain >= 10 && c2.gen === null, JSON.stringify({ ok: c2.last && c2.last.ok, gain: c2.gain, gen: c2.gen }));
const c3 = await swap([0, 0], [0, 1], []);
check('C3 无效交换仍回弹（ok=false、零得分）', c3.last && c3.last.ok === false && c3.gain === 0, JSON.stringify(c3.last));

// ---- N 不误伤 ----
const n1 = await (async () => {
  await page.evaluate(() => { window.__m3Debug.st().mode = 'simple'; });
  await setGrid([[2, 3, 30]]);
  const out = await tapTile(2, 3);
  await page.evaluate(() => { window.__m3Debug.st().mode = 'item'; });
  return out;
})();
check('N1 简单模式点道具格不引爆（gain=0，只按旧方式选中）', n1.gain === 0 && n1.now && n1.now.lock === false && !!n1.now.sel, JSON.stringify(n1.now));
const n2 = await tapTile(0, 0);
check('N2 普通格点击仍是「选中」语义（未引爆、未消耗回合）', n2.gain === 0 && n2.now && n2.now.lock === false && !!n2.now.sel, JSON.stringify(n2.now));
const n3 = await (async () => {
  await setGrid([[5, 5, dbg.LINE_V + 2]], { turn: 2 });
  const out = await tapTile(5, 5);
  return out;
})();
check('N3 TA 回合点道具无效（不抢回合、不引爆）', n3.gain === 0 && n3.now && n3.now.lock === false, JSON.stringify(n3.now));
const n4 = await (async () => {
  await setGrid([[6, 6, dbg.LINE_H]]);
  await page.evaluate(() => {
    let el = null;
    document.querySelectorAll('#m3-board .m3-tile').forEach((t) => { if (!el && t._r === 6 && t._c === 5) el = t; });
    if (el) el.click();   // 先点普通格 (6,5) 建立选中
  });
  const st1 = await page.evaluate(() => { const s = window.__m3Debug.st(); return { sel: s.sel && s.sel.slice(), lock: s.lock }; });
  const out = await tapTile(6, 6);   // 再点相邻的道具格＝交换（旧语义），不该被引爆劫持
  return { st1, out };
})();
check('N4 已选普通格→点相邻道具＝仍走交换（引爆劫持未越界）', n4.st1.lock === false && !!n4.st1.sel && n4.out.now && n4.out.now.lock === true, JSON.stringify(n4));
const n5 = await page.evaluate(() => {
  const d = window.__m3Debug;
  if (typeof d.propKind !== 'function') return 'propKind 未导出（旧 src，本断言无从量）';
  let bad = null;
  const probe = (v, want) => { const k = d.propKind(v); if (k !== want) bad = bad || (v + '→' + k + '≠' + want); };
  probe(d.LINE_V + 2, 'line-v'); probe(d.LINE_H + 2, 'line-h'); probe(d.RAINBOW, 'rainbow');
  probe(d.BOMB_BASE + 1, 'bomb'); probe(3, null); probe(-1, null); probe(d.LINE_V - 1, 'line-h');
  return bad;
});
check('N5 值域分档：直线 30+/40+ 先于彩虹判、负值与普通色不算道具', n5 === null, n5 || '');

check('Z 全程零未捕获页面错误', errors.length === 0, errors.join(' | ').slice(0, 200));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
await browser.close();
try { unlinkSync(tmpPage); } catch (e) {}
process.exit(fail ? 1 : 0);
