// ===== 回归脚本：拍卖会「点不动、只有重启才点动一次、后期又点不了」——TA 应价定时器被内核吞后的自愈（#1312） =====
// 用法：node build.mjs && node tools/verify-1312-auction-think-hang.mjs
// 背景（用户反馈：vivoS30 / Edge 拍卖会点不动，只有重启才能点动一次、后期又点不了；明说其他设备型号也有出现、要求不要覆盖式修补）：
//   根因＝竞拍「等 TA 应价」这一步的解锁，完全依赖单个 setTimeout(taThink)。安卓（vivo 等）激进后台管控会冻结/回收页面，
//   把那一发定时器整个吞掉：内核没回话时 thinkT 仍存死句柄、st.leader 停在 'you'，updateBidBtns 的 waiting 恒真
//   ＝出价三键＋放弃键永久置灰。旧的重开面板判据是 `if (!thinkT && leader==='you')`，对「死句柄（truthy）」这一路救不回，
//   于是只有整页重启（清掉闭包里的 st/thinkT）才又能动一次。零机型/零 UA 分支＝判据只取「内核这一发到底回没回话」一个事实：
//   回前台（mochi-fg-resume / visibilitychange→visible）或重开面板时，若正等 TA 却已过回执期限仍未落地，就地补排一次。
// 验证（无头 Chrome 390×844 触摸仿真）：夹具真把出价态跑出来，再用 __auDebug.swallowThink() 复刻「内核吞了那一发」的死局；
//   基线（HEAD 无本修复）在 dispatch mochi-fg-resume / 重开面板后仍永久置灰＝本契约红；本批产物自愈后按键重新可点＝绿。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('被测根目录 = ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9750 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1312-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
const uncaught = [];
await evalJs(`(function(){ window.__1312err = []; window.addEventListener('error', function(e){ window.__1312err.push(String(e.message||e)); }); return 1; })()`);
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// 关开屏：先走自然链路（滚到底 + 勾选年龄 + 点击进入）；未闭合时按 verify-1308 同款收口——
//   开屏是进入门控（scrolledBottom && ageOk && data-ready && window-load），无头新配置文件里
//   #splash-age-check 永不勾上 → #splash-enter 永久 is-disabled，与拍卖逻辑无关（同族既有红指纹）。
//   本批断言的是拍卖会 TA 自愈，门控本身不归本批管，故用同款强关；强关后仍读不到界面＝真挂了。
let splashClosed = false;
for (let i = 0; i < 12 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.hidden || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box'); if (sb) sb.scrollTop = sb.scrollHeight;
    var ck = document.getElementById('splash-age-check'); if (ck && !ck.checked) { ck.click(); }
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
if (!splashClosed) {
  await evalJs(`(function(){
    var b = document.querySelector('.splash-confirm-btn') || document.getElementById('splash-confirm-ok');
    if (b) b.click();
    var s = document.getElementById('splash');
    if (s) s.hidden = true;
    return 1;
  })()`);
  await sleep(300);
  splashClosed = await evalJs(`(function(){ var s = document.getElementById('splash'); return !s || s.hidden || s.classList.contains('hide'); })()`);
}
chk('P0 开屏已关闭', !!splashClosed, 'closed=' + splashClosed);
await sleep(500);

// 进聊天页 → 种足心意币 → 打开拍卖会 → 开一场
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1000);
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 999900, systemBalance: 999900 }); } catch (e) {} return 1; })()`);
await evalJs(`(function(){ var b = document.getElementById('more-auction'); if (b) { b.click(); return 'btn'; } if (window.openAuctionPanel) window.openAuctionPanel(); return 'api'; })()`);
await sleep(700);
await evalJs(`(function(){ if (window.__auDebug) window.__auDebug.newSession(); return 1; })()`);
await sleep(400);

const dbg = (fn) => `(function(){ try { var v = (${fn})(); return v === null || v === undefined ? 'null' : JSON.stringify(v); } catch (e) { return 'ERR:'+e.message; } })()`;
// 轻量状态探针：st() 里 lots 可能含 base64 商品图，整份 JSON 经 CDP 回传会超限打断脚本——只取本批关心的字段。
const stq = `(function(){ var d=window.__auDebug; if(!d) return 'no-dbg'; var s=d.st(); return s? JSON.stringify({leader:s.leader,phase:s.phase,started:s.started,over:s.over,cur:s.cur}) : 'null'; })()`;
const readSt = async () => { try { const r = await evalJs(stq); return r === 'null' || r === 'no-dbg' ? null : JSON.parse(r); } catch (e) { return null; } };
const btnState = () => `(function(){
  var g = function(id){ var e = document.getElementById(id); return e ? !!e.disabled : null; };
  return JSON.stringify({ bid1: g('au-bid1'), bid5: g('au-bid5'), bid13: g('au-bid13'), pass: g('au-pass') });
})()`;

// 夹具真实性：确认 __auDebug 的吞帧口在位（本批新增），否则后续断言全是空跑
const fixture = await evalJs(`(function(){ var d = window.__auDebug || {}; return JSON.stringify({ heal: typeof d.heal, swallow: typeof d.swallowThink, st: typeof d.st }); })()`);
chk('A0 夹具接口就位（__auDebug.heal / swallowThink 存在＝被测产物含本批调试口）', /"heal":"function"/.test(fixture) && /"swallow":"function"/.test(fixture), fixture);

// ---------- S) 静态锚（读外置产物 js/auction.js＝文件级唯一；只取压缩后仍不重写的 token） ----------
const auc = readFileSync(join(root, 'js', 'auction.js'), 'utf8');
chk('S1 锚·scheduleTaThink 记录回执期限（st.thinkDue = Date.now() + delay）', /st\.thinkDue\s*=\s*Date\.now\(\)\s*\+\s*delay/.test(auc));
chk('S2 锚·回前台自愈绑到拍卖文件（addEventListener m-fg 口）', /addEventListener\('mochi-fg-resume',\s*healStuckThink\)/.test(auc));
chk('S3 锚·吞帧取证调试口 swallowThink 在产物（本批新增契约面）', /swallowThink/.test(auc));
chk('S4 锚·3500ms 宽限窗比较在产物（判死活的尺，删＝自愈不存在）', /st\.thinkDue\s*&&\s*Date\.now\(\)\s*>\s*st\.thinkDue\s*\+\s*3500/.test(auc));
chk('S5 锚·重开面板接线走自愈（renderLot(); healStuckThink();）', /renderLot\(\);\s*healStuckThink\(\)/.test(auc));

// ---------- B) 行为契约 ----------
// B1：出价推进真实场次态（leader=you、竞价中）。两侧皆绿＝夹具真的在跑这场拍卖，非空跑。
//     注意：本仓 scheduleTaThink 在赋 thinkT 之前就先算了一次 updateBidBtns，所以「活窗期」按键本就不灰
//     （灰不灰与基线无关，故 B1 不断言灰，只断言推进到了等 TA 态）。
await evalJs(`(function(){ if (window.__auDebug) window.__auDebug.myBid(100); return 1; })()`);
await sleep(120);
const b1st = await readSt();
chk('B1 出价推进到等 TA 态（leader=you 且 bidding）', !!b1st && b1st.leader === 'you' && b1st.phase === 'bidding' && b1st.started === true && b1st.over === false, JSON.stringify(b1st));

// B2：忠实复刻「内核把 taThink 那一发吞了」的死局——清掉真定时器、留一个死的真值句柄、回执期限挪到远古，
//     并触发一次按键重算（＝用户重开面板/下一次渲染撞上 waiting 恒真那一刻）。此后即便再等也永不自解＝「点不动」本体。
await evalJs(`(function(){ if (window.__auDebug && window.__auDebug.swallowThink) window.__auDebug.swallowThink(); return 1; })()`);
await sleep(120);
const b2pre = JSON.parse(await evalJs(btnState()));
await sleep(2200);   // 远超最长思考窗（1750ms）＋宽限前段；无自愈则仍死灰
const b2 = JSON.parse(await evalJs(btnState()));
const b2st = await readSt();
chk('B2 吞帧后按键立即全灰（死句柄使 waiting 恒真，复现症状）', b2pre.bid1 === true && b2pre.bid5 === true && b2pre.bid13 === true && b2pre.pass === true, JSON.stringify(b2pre));
chk('B2b 再等 2.2s 仍全灰且仍 leader=you/bidding（＝永不自解的真卡死，非短暂锁）', b2.bid1 === true && b2.pass === true && !!b2st && b2st.leader === 'you' && b2st.phase === 'bidding', JSON.stringify({ btn: b2, st: b2st }));

// B3：本批核心契约之一——回前台（dispatch mochi-fg-resume）触发自愈：补排后 TA 必须回话，
//     死局判据「leader=you 且仍在 bidding」被破除（跟价＝轮到你；折价＝本件落槌/流拍 phase=done，都算解）。
//     前提＝死局确已建立（B2b 读到 leader=you 且 bidding）：基线无吞帧夹具、场次被真实定时器自然推进时，
//     "phase=done" 不是自愈的功劳，不能算绿——要求建立否则如实红。
const b3established = !!b2st && b2st.leader === 'you' && b2st.phase === 'bidding';
await evalJs(`(function(){ document.dispatchEvent(new Event('mochi-fg-resume')); return 1; })()`);
await sleep(2600);   // 补排后 taThink 于 850~1750ms 窗口内回话
const b3st = await readSt();
const b3 = JSON.parse(await evalJs(btnState()));
const b3resolved = !!b3st && (b3st.phase !== 'bidding' || b3st.leader !== 'you');
chk('B3 回前台自愈：等 TA 死局被破除（不再 leader=you 死等于 bidding）', b3established && b3resolved, JSON.stringify({ established: b3established, btn: b3, st: b3st }));

// B4：本批核心契约之二——重开面板（旧 !thinkT 判据救不回死句柄）也走同一把自愈
await evalJs(`(function(){ if (window.__auDebug) window.__auDebug.newSession(); return 1; })()`);
await sleep(300);
await evalJs(`(function(){ if (window.__auDebug) window.__auDebug.myBid(100); return 1; })()`);
await sleep(120);
await evalJs(`(function(){ if (window.__auDebug && window.__auDebug.swallowThink) window.__auDebug.swallowThink(); return 1; })()`);
await sleep(200);
const b4pre = JSON.parse(await evalJs(btnState()));
chk('B4 吞帧死局成立（重开前出价键灰＋仍 leader=you）', b4pre.bid1 === true && b4pre.pass === true, JSON.stringify(b4pre));
// 通过入口重开面板（openAuctionPanel 现走 healStuckThink；旧代码走 !thinkT 判据救不回死句柄）
//     同样要求死局先建立（b4pre 全灰），否则基线上场次自然推进也会让这条假绿。
await evalJs(`(function(){ if (window.openAuctionPanel) window.openAuctionPanel(); return 1; })()`);
await sleep(2600);
const b4st = await readSt();
const b4established = b4pre.bid1 === true && b4pre.pass === true;
const b4resolved = !!b4st && (b4st.phase !== 'bidding' || b4st.leader !== 'you');
chk('B4 重开面板自愈：补排后 TA 已回话（死局破除）', b4established && b4resolved, JSON.stringify({ established: b4established, st: b4st }));

// B5：自愈不抢仍在跑的活定时器——正等 TA 且回执期限未过（活窗内）时 heal 应 no-op（thinkDue 不被重排）
await evalJs(`(function(){ if (window.__auDebug) window.__auDebug.newSession(); return 1; })()`);
await sleep(300);
await evalJs(`(function(){ if (window.__auDebug) window.__auDebug.myBid(100); return 1; })()`);
await sleep(120);   // 仍在活窗（850~1750ms）内
const dueQ = `(function(){ var d=window.__auDebug; var s=d&&d.st(); return (s && s.thinkDue) ? s.thinkDue : 0; })()`;
const b5due = await evalJs(dueQ);
await evalJs(`(function(){ if (window.__auDebug && window.__auDebug.heal) window.__auDebug.heal(); return 1; })()`);
await sleep(150);
const b5due2 = await evalJs(dueQ);
chk('B5 活定时器不被 heal 重排（thinkDue 未变＝不抢仍在跑的窗；基线无 thinkDue＝红）', b5due > 0 && b5due2 === b5due, 'before=' + b5due + ' after=' + b5due2);

// Z1：全程零未捕获异常
const errs = await evalJs(`(function(){ return JSON.stringify(window.__1312err || []); })()`);
let errArr = []; try { errArr = JSON.parse(errs); } catch (e) {}
chk('Z1 全程零未捕获异常', errArr.length === 0, errs);

console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
