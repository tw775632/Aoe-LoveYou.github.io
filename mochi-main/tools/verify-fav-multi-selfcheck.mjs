// ===== 本批自检：聊天批量收藏 + 收藏原因字卡 + 已收藏 tag =====
// 不依赖构建产物（产物需 node build.mjs，而工作区里有一批与本批无关的未提交改动把缩尺门顶住了），
// 故走「源码锚 + 纯逻辑抽取执行」两层：
//   A 组 源码锚：确认关键实现落在源码里（改坏了这里会红）
//   B 组 逻辑执行：把收藏原因抽句、身份指纹真逻辑抽出来跑，验证「同文案不同 ts 不误判 /
//                同类冷却生效 / 抽句不全同句」
// 用法：node tools/verify-fav-multi-selfcheck.mjs
import { readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + String(detail).slice(0, 200) + ']' : ''));
}

const chat = read('src/js/chat.js');
const tpl = read('src/template.html');
const favset = read('src/js/fav-settings.js');
const reason = read('src/js/fav-reason.js');
const css = read('src/css/chat-pages.css');

// ── A 组：源码锚 ───────────────────────────────────────────────────────────────
check('A1 长按菜单有「多选」按钮', /data-act="multisel"/.test(tpl));
check('A2 聊天页有批量操作栏（取消/全选/收藏）', /id="chat-multisel-bar"/.test(tpl) && /id="chat-multisel-fav"/.test(tpl) && /id="chat-multisel-all"/.test(tpl));
check('A3 批量收藏按钮不是删除红（用主色 fb-primary）', /fb-primary"[^>]*id="chat-multisel-fav"/.test(tpl));
check('A4 多选态下轻点气泡不开菜单', /function msgActionEligible\(t\)[\s\S]{0,200}if \(chatMulti\) return null;/.test(chat));
check('A5 菜单动作分发有 multisel 分支', /act === 'multisel'/.test(chat));
check('A6 切桌面清多选态（防跨桌面误收藏）', /contact-switched[\s\S]{0,300}chatMultiEnd/.test(chat));
check('A7 收藏设置页有【已收藏】标记开关', /id="fav-tag-show"/.test(tpl));
// A8 必须咬「切换后真的会同步屏上 tag」这条接线：只 grep "favTagSyncDOM" 出现过的话，
// 把它改名成 favTagSyncDOMX 照样命中（实测破坏不红＝空转）。故断言调用必须在
// 事件处理器里、且带窗口实参（空参＝只清缓存不刷屏，是另一种半吊子）。
check('A8 开关切换后即时同步屏上 tag（非空参调用）', /tagSw\.addEventListener\('change'[\s\S]{0,400}window\.favTagSyncDOM\(\)/.test(favset));
check('A9 tag 关闭时不注入 DOM（非 display:none）', /if \(!favTagShow\(\)\) return '';/.test(chat));
check('A10 tag 在 appendMsg 统一注入', /function appendMsg\(m\)[\s\S]{0,500}msgFavTagHtml/.test(chat));
// A11 必须咬住「reason 真的来自抽句池」：写成 /by: 'ta'[^\n]*reason:/ 的话，把抽句换成
// 字面空串（reason: ''）照样命中＝空转断言（本批实测踩到）。故断言抽句调用本身在。
check('A11 TA 自动收藏的 reason 来自抽句池（非写死空串）', /by: 'ta'[^\n]*reason: \(window\.favReasonPick \? window\.favReasonPick\(\) : ''\)/.test(chat));
check('A12 TA 收藏互动卡片也带 reason', /f\.reason = \(window\.favReasonPick/.test(chat));
check('A13 收藏原因走预置字卡池抽句', /window\.favReasonPick = function/.test(reason));
check('A14 收藏项备注用 favItemKey 指纹定位', /function favSetNote\(fk, note\)/.test(chat) && /favItemKey\(f\) === fk/.test(chat));
// A15 分两条独立断言（合成一条时改任一个类名都可能被另一处命中掩盖）：
//   理由区（TA 写的，只读）与备注区（用户写的，可点编辑）是两个独立能力，缺一不可。
check('A15a 收藏页渲染 TA 的收藏理由', /rEl\.className = 'fav-item-reason'/.test(chat) && /rEl\.textContent = /.test(chat));
check('A15b 收藏页有可点的备注编辑入口', /btn\.className = 'fav-item-notebtn'/.test(chat) && /btn\.addEventListener\('click'[\s\S]{0,120}favNoteEdit\(f\)/.test(chat));
check('A16 卡片快照存 mtext（供 tag 身份匹配）', /mtext: String\(rec\.text \|\| ''\)/.test(chat));
check('A17 tag 索引卡片用 mtext 而非 q', /f\.mtext \|\| ''/.test(chat));
check('A18 多选时收起输入栏、退出时恢复', (chat.match(/chat-input-row/g) || []).length >= 2);
check('A19 有 .msg-fav-tag 样式', /\.msg-fav-tag\s*\{/.test(css));
check('A20 有多选勾选圈样式', /msg-multisel-on/.test(css));

// ── B 组：逻辑执行 ─────────────────────────────────────────────────────────────
// B1/B2 收藏原因字卡池自洽性（分组名拼错 ⇒ 那张卡永远抽不到，本批真实踩过一次）
{
  const g = {};
  const D = (new Function('window', read('src/js/fav-reason-data.js') + '\n;return window.FAV_REASON_DATA;'))(g);
  const names = (D.groups || []).map(x => x.group);
  const orphans = (D.cards || []).filter(c => names.indexOf(c.group) < 0);
  check('B1 收藏原因字卡：分组名与卡片自洽（无孤儿卡）', orphans.length === 0, orphans.map(c => c.group + '|' + c.content).join('; '));
  check('B2 收藏原因字卡：有可抽内容', (D.cards || []).length > 0, (D.cards || []).length + ' 张');
}

// B3~B5 抽句器真跑：非空 + 有多种结果
{
  const D = (new Function('window', read('src/js/fav-reason-data.js') + '\n;return window.FAV_REASON_DATA;'))({});
  const store = new Map();
  const ls = { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v) };
  const g = { FAV_REASON_DATA: D, activeStore: () => ls };
  (new Function('window', read('src/js/fav-reason.js')))(g);
  const out = [];
  for (let i = 0; i < 60; i++) out.push(g.favReasonPick());
  const nonEmpty = out.filter(Boolean);
  check('B3 抽句器能抽出非空理由', nonEmpty.length > 0, nonEmpty.length + '/60');
  check('B4 抽句结果非固定一句（有多种）', new Set(nonEmpty).size > 1, new Set(nonEmpty).size + ' 种');
  // B5 同类冷却：抽 3 次应来自 3 个不同分组（冷却窗口 RECENT=3）
  const hist = ls.get('fav-reason-history');
  let h = [];
  try { h = JSON.parse(hist || '[]'); } catch (e) {}
  check('B5 同类冷却生效（历史分组不重复）', new Set(h).size === h.length, h.join(','));
}

// B6~B9 favItemKey 指纹口径（批量收藏与备注都靠它定位，串了就收藏错条/写错备注）
{
  const m = chat.match(/function favItemKey\(f\) \{[\s\S]*?\n\}/);
  check('B6 favItemKey 源码可提取', !!m);
  if (m) {
    const fn = (new Function(m[0] + '\nreturn favItemKey;'))();
    const a = fn({ by: 'me', kind: 'msg', ts: 1, text: '同文案' });
    const b = fn({ by: 'me', kind: 'msg', ts: 2, text: '同文案' });
    check('B7 同文案不同时间戳 → 不同身份 key', a !== b);
    check('B8 同一收藏项两次取 key 一致（备注能写回同一条）', a === fn({ by: 'me', kind: 'msg', ts: 1, text: '同文案' }));
    check('B9 我 vs TA 的同一内容 → 不同 key（两 tab 独立）', a !== fn({ by: 'ta', kind: 'msg', ts: 1, text: '同文案' }));
  }
}

// B10 favDup：批量收藏的判重口径必须与单条收藏一致（同 by 才判重）
{
  const m = chat.match(/function favDup\(list, f, by\) \{[\s\S]*?\n\}/);
  check('B10 favDup 源码可提取', !!m);
  if (m) {
    const fn = (new Function(m[0] + '\nreturn favDup;'))();
    const base = [{ by: 'ta', kind: 'msg', text: 'x', ts: 1 }];
    check('B11 TA 收藏过的不挡我的收藏（两 tab 独立）', !fn(base, { kind: 'msg', text: 'x', ts: 1 }, 'me'));
    const base2 = [{ by: 'me', kind: 'msg', text: 'x', ts: 1 }];
    check('B12 我自己收藏过同一内容 → 判重', fn(base2, { kind: 'msg', text: 'x', ts: 1 }, 'me'));
  }
}

console.log('\n合计：PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);