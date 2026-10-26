// verify-1274-home-nick-record-split.mjs — #1274 主页「换头像记录 / 换昵称记录没有分开」行为回归
// 用法（绿侧＝缺省读本仓 src）：node tools/verify-1274-home-nick-record-split.mjs
// 红侧（纯基线，钉死本批入库前的提交，别用会前移的 HEAD）：
//   git show <基线>:src/js/records.js    > ../r_records.js
//   git show <基线>:src/js/avatar-lib.js > ../r_avatar-lib.js
//   node tools/verify-1274-home-nick-record-split.mjs --records ../r_records.js --avatarlib ../r_avatar-lib.js
// 口径：无头产物此刻还不存在（本批不构建），故走 vm 抽真身——把 records.js / avatar-lib.js 里
// 本批涉及的函数原样抽出真跑，判据＝「记录文案含昵称」这一数据事实与写入口本身，不测字符串影子。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const recPath = opt('--records', fileURLToPath(new URL('../src/js/records.js', import.meta.url)));
const avPath = opt('--avatarlib', fileURLToPath(new URL('../src/js/avatar-lib.js', import.meta.url)));
const tplPath = opt('--template', fileURLToPath(new URL('../src/template.html', import.meta.url)));
const recSrc = readFileSync(recPath, 'utf8');
const avSrc = readFileSync(avPath, 'utf8');
const tplSrc = readFileSync(tplPath, 'utf8');

function extractFn(src, name) {
  const s1 = 'function ' + name + '(';
  const s2 = 'window.' + name + ' = function (';
  const i1 = src.indexOf(s1), i2 = src.indexOf(s2);
  const i = i1 >= 0 ? i1 : i2;
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}

const results = [];
function T(name, fn) { try { results.push([name, fn()]); } catch (e) { results.push([name, 'ERR ' + (e && e.message)]); } }

// ---------- records.js：存储层真跑（抽出的就是线上那几行） ----------
const REC_PARTS = ['avatarsLoad', 'avatarsSave', 'nicksLoad', 'nicksSave', 'isNickRec', 'avatarRecords', 'nickLegacy', 'nickRecords', 'addNickRecord', 'addAvatarRecord'];
function recSandbox(seed, opts) {
  const pending = !!(opts && opts.pending);
  const ls = new Map(Object.entries(seed || {}));
  const store = {
    get: k => (ls.has(k) ? ls.get(k) : null),
    set: (k, v) => { ls.set(k, String(v)); },
    remove: k => { ls.delete(k); }
  };
  const win = { activePrefix: () => 'xy-home-v2:default', idbGet: null, mochiDataPending: () => pending };
  const sb = {
    store, window: win, JSON, Date, Math,
    document: { getElementById: () => ({ hidden: true }) },
    render: () => {},
    setTimeout: () => {},
    __ls: ls,
  };
  const code = REC_PARTS.map(n => extractFn(recSrc, n)).filter(Boolean).join('\n')
    // 逐个 typeof 守卫导出：旧版没有的函数留 undefined，让对照组断言在两侧都跑得起来（不整段崩）
    + REC_PARTS.map(n => '\n__out.' + n + ' = (typeof ' + n + " === 'function') ? " + n + ' : undefined;').join('');
  sb.__out = {};
  sb._avTrusted = true; // 新版的「未证实禁空写」闸在真实页面里由回填放行，本测只测分流不动写闸
  sb._nickLegacy = null; // 新版的「历史只认一次」缓存（旧版没这个变量，声明了也不影响）
  // 旧版（基线）没有这些函数：抽到什么跑什么，缺的由断言自己判红
  const missing = REC_PARTS.filter(n => !extractFn(recSrc, n));
  vmRun(code, sb);
  return {
    ...sb.__out,
    missing,
    raw: k => (ls.has(k) ? ls.get(k) : null),
    put: (k, v) => { ls.set(k, v); },
    addNick: t => (typeof win.addNickRecord === 'function' ? (win.addNickRecord(t), true) : 'NOFN'),
    addAv: (img, t) => (typeof win.addAvatarRecord === 'function' ? (win.addAvatarRecord(img, t), true) : 'NOFN'),
  };
}
function vmRun(code, sb) {
  vm.createContext(sb);
  vm.runInContext(code, sb, { timeout: 2000 });
}

const AV_LEGACY = JSON.stringify([
  { img: 'data:image/png;base64,AAA', text: '我把 TA 的聊天昵称换成了「小满」', ts: 3000 },
  { img: 'data:image/png;base64,BBB', text: '我 更换了 阿言 的头像', ts: 2000 },
  { img: null, text: 'TA 拒绝了我的换头像邀请', ts: 1500 },
  { img: 'data:image/png;base64,CCC', text: '我把自己的聊天昵称换成了「团子」', ts: 1000 },
]);

T('A1 换昵称事件写进 records-nick，不写 records-avatar（红侧＝无 addNickRecord）', () => {
  const s = recSandbox({});
  if (s.missing.includes('addNickRecord')) return 'FAIL(旧侧无 addNickRecord)';
  if (s.addNick('TA 把聊天昵称换成了「小满」') !== true) return 'FAIL';
  const nk = JSON.parse(s.raw('records-nick') || '[]');
  const av = s.raw('records-avatar');
  return nk.length === 1 && nk[0].text === 'TA 把聊天昵称换成了「小满」' && av == null ? true : 'FAIL nick=' + s.raw('records-nick') + ' av=' + av;
});
T('A2 换头像栏只列头像事件（历史混进 records-avatar 的换昵称条目不再出现在头像栏）', () => {
  const s = recSandbox({ 'records-avatar': AV_LEGACY });
  if (s.missing.includes('avatarRecords')) return 'FAIL(旧侧无 avatarRecords)';
  const list = s.avatarRecords();
  return list.length === 2 && list.every(x => !/昵称/.test(x.text)) ? true : 'FAIL ' + JSON.stringify(list.map(x => x.text));
});
T('A3 换昵称栏＝历史混排那批 ＋ 新键，按时间倒序且不丢', () => {
  const s = recSandbox({ 'records-avatar': AV_LEGACY, 'records-nick': JSON.stringify([{ text: '我把自己的聊天昵称换成了「团子2」', ts: 2500 }]) });
  if (s.missing.includes('nickRecords')) return 'FAIL(旧侧无 nickRecords)';
  const list = s.nickRecords();
  const ts = list.map(x => x.ts);
  const ok = list.length === 3 && ts.join(',') === '3000,2500,1000' && list.every(x => /昵称/.test(x.text));
  return ok ? true : 'FAIL ' + JSON.stringify(list.map(x => x.ts + ':' + x.text));
});
T('A4 新键为空时历史那批仍读得回来（红侧＝老数据只出现在换头像栏）', () => {
  const s = recSandbox({ 'records-avatar': AV_LEGACY });
  if (s.missing.includes('nickRecords')) return 'FAIL(旧侧无 nickRecords)';
  return s.nickRecords().length === 2 ? true : 'FAIL ' + s.nickRecords().length;
});
T('A5 存储读本身不动：全是头像事件时原样读到 2 条（两侧皆绿的对照组）', () => {
  const seed = JSON.stringify([{ img: 'x', text: '我 更换了头像', ts: 5 }, { img: 'y', text: 'TA 更换了头像', ts: 4 }]);
  const s = recSandbox({ 'records-avatar': seed });
  return s.avatarsLoad().length === 2 ? true : 'FAIL ' + s.avatarsLoad().length;
});
T('A6 判据是文案而不是「有没有图」：拒绝换头像（img 为空）仍留在头像栏（对照组）', () => {
  const s = recSandbox({ 'records-avatar': AV_LEGACY });
  if (s.missing.includes('isNickRec')) return 'FAIL(旧侧无 isNickRec)';
  const rejected = { img: null, text: 'TA 拒绝了我的换头像邀请', ts: 1500 };
  const inNick = s.nickRecords().some(x => x.text === rejected.text);
  const inAv = s.avatarRecords().some(x => x.text === rejected.text);
  return !inNick && inAv ? true : 'FAIL nick=' + inNick + ' av=' + inAv;
});
T('A7 换头像写入路径不动：addAvatarRecord 仍写 records-avatar（对照组）', () => {
  const s = recSandbox({ 'records-avatar': JSON.stringify([{ img: 'x', text: '我 更换了头像', ts: 5 }]) });
  if (s.addAv('data:image/png;base64,ZZZ', '我 更换了头像') !== true) return 'FAIL';
  const av = JSON.parse(s.raw('records-avatar'));
  const nickN = s.nickRecords ? s.nickRecords().length : 0;
  return av.length === 2 && nickN === 0 ? true : 'FAIL av=' + av.length + ' nick=' + nickN;
});
T('A8 分流只读不搬：跑完一遍后 records-avatar 原文一字节未动', () => {
  const s = recSandbox({ 'records-avatar': AV_LEGACY });
  if (s.missing.includes('nickRecords')) return 'FAIL(旧侧无 nickRecords)';
  s.avatarRecords(); s.nickRecords();
  return s.raw('records-avatar') === AV_LEGACY ? true : 'FAIL ' + s.raw('records-avatar');
});

T('A9 回填未完成时不认「历史里没有」：晚到的历史换昵称条目仍读得回来（缓存安全性对照组；旧侧无分流栏＝SKIP）', () => {
  const s = recSandbox({ 'records-avatar': '[]' }, { pending: true });
  if (s.missing.includes('nickRecords')) return 'SKIP(旧侧无 nickRecords)';
  if (s.nickRecords() && s.nickRecords().length !== 0) return 'FAIL 首趟不该有';
  s.put('records-avatar', AV_LEGACY);
  return s.nickRecords().length === 2 ? true : 'FAIL ' + s.nickRecords().length;
});
T('A10 历史只认一次（含图大键不每渲染重解析）：数据就绪后缓存生效（红侧＝无缓存）', () => {
  const s = recSandbox({ 'records-avatar': '[]' }, { pending: false });
  if (s.missing.includes('nickRecords')) return 'FAIL(旧侧无 nickRecords)';
  s.nickRecords();
  s.put('records-avatar', AV_LEGACY);
  return s.nickRecords().length === 0 ? true : 'FAIL 第二次读到 ' + s.nickRecords().length + ' 条＝又解析了一遍';
});

// ---------- avatar-lib.js：写入口真跑 ----------
const AV_PARTS = ['chatSystem', 'chatSystemNick'];
function avSandbox({ late }) {
  const sys = [], nk = [], av = [];
  const timers = [];
  const win = {
    chatAddSystem: (text, opts) => { sys.push({ text, opts }); },
    addNickRecord: late ? undefined : (t) => { nk.push(t); },
    addAvatarRecord: (img, t) => { av.push({ img, t }); },
  };
  const sb = {
    window: win, JSON, Date, Math,
    setTimeout: (f) => { timers.push(f); },
  };
  const code = AV_PARTS.map(n => extractFn(avSrc, n)).filter(Boolean).join('\n')
    + '\n__out.chatSystem = chatSystem;' + (extractFn(avSrc, 'chatSystemNick') ? ' __out.chatSystemNick = chatSystemNick;' : '');
  sb.__out = {};
  vm.createContext(sb);
  vm.runInContext(code, sb, { timeout: 2000 });
  return { api: sb.__out, sys, nk, av, run: () => { if (late) win.addNickRecord = (t) => { nk.push(t); }; timers.forEach(f => f()); } };
}
T('B1 chatSystemNick 存在（红侧＝旧版只有 chatSystem 一条出口）', () => {
  if (!extractFn(avSrc, 'chatSystemNick')) return 'FAIL(旧侧无 chatSystemNick)';
  const s = avSandbox({});
  s.api.chatSystemNick('TA 把聊天昵称换成了「小满」');
  return s.nk.length === 1 && s.av.length === 0 ? true : 'FAIL nick=' + s.nk.length + ' av=' + s.av.length;
});
T('B2 换昵称出口仍带 nickKeep=true（#616 改名清扫豁免不能丢）', () => {
  const s = avSandbox({});
  if (!s.api.chatSystemNick) return 'FAIL(旧侧)';
  s.api.chatSystemNick('我把 TA 的聊天昵称换成了「小满」');
  return s.sys.length === 1 && s.sys[0].opts.nickKeep === true ? true : 'FAIL ' + JSON.stringify(s.sys);
});
T('B3 换头像出口照旧（写 addAvatarRecord、nickKeep 不为真，对照组）', () => {
  const s = avSandbox({});
  s.api.chatSystem('我 更换了 阿言 的头像', 'data:image/png;base64,AAA');
  return s.av.length === 1 && s.av[0].img === 'data:image/png;base64,AAA' && !s.sys[0].opts.nickKeep && s.nk.length === 0 ? true : 'FAIL ' + JSON.stringify(s.av) + '/' + s.nk.length;
});
T('B4 records.js 晚到时换昵称补写一趟（与换头像同口径，红侧＝无出口）', () => {
  const s = avSandbox({ late: true });
  if (!s.api.chatSystemNick) return 'FAIL(旧侧)';
  s.api.chatSystemNick('TA 把我的聊天昵称换成了「团子」');
  const before = s.nk.length;
  s.run();
  return before === 0 && s.nk.length === 1 ? true : 'FAIL before=' + before + ' after=' + s.nk.length;
});
T('B5 六个换昵称入口全部改走新出口（src 里不得再有 chatSystem(..., null, true)）', () => {
  const n = (avSrc.match(/chatSystem\([^)]*,\s*null,\s*true\s*\)/g) || []).length;
  return n === 0 ? true : 'FAIL 残留' + n + '处';
});
T('B6 换昵称出口只此一份定义，且昵称文案函数全部接新出口', () => {
  const def = (avSrc.match(/function chatSystemNick\(/g) || []).length;
  const used = (avSrc.match(/chatSystemNick\(/g) || []).length;
  const msgs = ['nickMsgPartner', 'nickMsgMeSet', 'nickMsgMeSelf', 'nickMsgTaSetMine'].every(fn => new RegExp('chatSystemNick\\(' + fn + '\\(').test(avSrc) || new RegExp('const text = ' + fn + '\\([^)]*\\);\\s*\\n?\\s*(try\\{|chatSystemNick)').test(avSrc));
  return def === 1 && used >= 5 && msgs ? true : 'FAIL def=' + def + ' used=' + used + ' msgs=' + msgs;
});

// ---------- template：锚点两侧接线 ----------
T('C1 template 有「换昵称记录」tab 按钮', () => {
  return tplSrc.includes('data-htab="nick"') && tplSrc.includes('>换昵称记录</button>') ? true : 'FAIL';
});
T('C2 template 有对应面板与渲染槽（data-hpanel="nick" + id="home-nick"）', () => {
  return tplSrc.includes('data-hpanel="nick"') && tplSrc.includes('id="home-nick"') ? true : 'FAIL';
});
T('C3 records.js 渲染接线 htab=nick → home-nick → nickRecords', () => {
  return /showOnly === 'nick'[\s\S]{0,120}getElementById\('home-nick'\)[\s\S]{0,160}nickRecords\(\)/.test(recSrc) ? true : 'FAIL';
});
T('C4 换头像栏接线改走分流后的列表（不再直接渲染整把 records-avatar）', () => {
  return /showOnly === 'av'[\s\S]{0,200}const list = avatarRecords\(\);/.test(recSrc) ? true : 'FAIL';
});

// ---------- 零机型／零 UA 分支（本批触及的两段抽取） ----------
const touched = REC_PARTS.map(n => extractFn(recSrc, n)).filter(Boolean).join('\n')
  + AV_PARTS.map(n => extractFn(avSrc, n)).filter(Boolean).join('\n');
T('Z1 本批触及代码零机型／零 UA 分支', () => !/navigator\.userAgent|iPhone|iPad|Android|Chrome|MicroMessenger|Edge|Huawei|Xiaomi/i.test(touched) ? true : 'FAIL');
T('Z2 换昵称键名统一为 records-nick（两文件同一条键，无第三种写法）', () => {
  const bad = /records-nickname|records-nickName|records-usernick/i.test(recSrc + avSrc);
  const ok = /'records-nick'/.test(recSrc);
  return !bad && ok ? true : 'FAIL bad=' + bad + ' ok=' + ok;
});

let pass = 0, fail = 0;
for (const [name, r] of results) {
  if (r === true) { pass++; console.log('  ✅ ' + name); }
  else if (String(r).startsWith('SKIP')) { console.log('  ⏭️ ' + name + ' → ' + r); }
  else { fail++; console.log('  ❌ ' + name + ' → ' + r); }
}
console.log((fail ? '❌' : '✅') + ' verify-1274 ' + pass + '/' + fail + ' （records=' + recPath + ' / avatar-lib=' + avPath + '）');
process.exit(fail ? 1 : 0);
