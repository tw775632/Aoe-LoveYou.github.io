// #1521 行为尺（重写：三类内核模型显式化，零时间赛跑）
// ① overlay 内核（GT7/K80 Edge）：瞬时收缩（同一拍）后全高 → 会话 <400ms 不判诚实 → B 型顶住 → vk 实测接管
// ②诚实内核（Chrome/华为）：持续收缩 ≥400ms 后全高 → 全高＝真收口 → 秒回位
// ③零信号内核（OPPO/荣耀）：无任何收缩 → 会话不开 → 保底救援（另由 #1512 尺覆盖）
// 用法：node tools/verify-1521-kb-converge.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 140) + ']' : ''));
}
function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
const jsMA = rd('js/mobile-adapt.js');
check('S1 三类内核一条规则·主链（删＝800/650/300ms 时间引信＝打字间隔＞窗口必拆会话＝两态横跳引擎）', jsMA.includes('if (_focNow && _aHoldNow()) { if (!_aVkHonest)'));
check('S2 三类内核一条规则·轮询腿', jsMA.includes('if (_focNow && _aHoldNow()) return;'));
check('S3 诚实内核判位（删＝秒收退化为「打字停顿才秒收」）', jsMA.includes('if (_aKb && h < _aH - 60 && Date.now() - _aKbAt > 400) _aHonestSession = 1;'));
check('S4 残差只在读数/轴值变化后记一次（删＝每拍残差自反馈振荡＝GT7 实报闪屏抖动）', jsMA.includes("if (_sig === _aLastDockSig) return '';"));
check('S5 高度出口取整＋2px 死区（删＝逐拍写 637.333px＝OPPO reno16 实报抖动源）', jsMA.includes("if (want > 0 && Math.abs(want - _cur) > 2) _aPhone.style.height = want + 'px';"));
check('S6 收口抑制窗 1.2s（删＝收口后保底救援同拍踢回＝点一下回位又跳）', jsMA.includes('_aHoldSuppressUntil = Date.now() + 1200;'));

const cands = [process.env.CHROME_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
const browserPath = cands.filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { process.stderr.write('no browser\n'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const port = 30900 + Math.floor(Math.random() * 300);
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', '--user-data-dir=' + join(process.env.TEMP, 'm1521-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const ERRS = [];
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; }); break; } } catch (e) {}
  await sleep(150);
}
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const cdp = (me, pa = {}) => { const i = ++msgId; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: pa })); }); };
const ev = async (ex) => { const r = await cdp('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) { ERRS.push(1); } return r && r.result ? r.result.value : null; };
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var vv={height:844,width:390,scale:1,offsetTop:0,offsetLeft:0,_ls:{},addEventListener:function(t,f){(vv._ls[t]=vv._ls[t]||[]).push(f);},removeEventListener:function(){},scrollTo:function(){},dispatch:function(t){(vv._ls[t]||[]).slice().forEach(function(f){try{f();}catch(e){}});}};Object.defineProperty(window,'visualViewport',{configurable:true,get:function(){return vv;}});window.__fakeVV=vv;var vk={overlaysContent:false,boundingRect:{x:0,y:488,width:390,height:356},_ls:{},addEventListener:function(t,f){(vk._ls[t]=vk._ls[t]||[]).push(f);},removeEventListener:function(){},dispatch:function(){(vk._ls.geometrychange||[]).slice().forEach(function(f){try{f({});}catch(e){}});}};try{Object.defineProperty(navigator,'virtualKeyboard',{configurable:true,get:function(){return vk;}});}catch(e){}window.__fakeVK=vk;return 1;})()" });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev("typeof window.mochiScreenAdj==='object'&&!!document.querySelector('.phone')")) break; await sleep(300); }
await cdp('Page.bringToFront'); await sleep(300);
await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}if(document.activeElement!==t){try{t.focus();}catch(e2){}}},600);return 1;})()");
const H = "(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()";
async function pollH(exp, to) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < (to || 5000)) { last = await ev(H); if (last === exp) return true; await sleep(120); }
  console.log('  [timeout] 期望 ' + exp + ' 实际 ' + last);
  return false;
}
async function resetAll() {
  await ev("(function(){window.mochiScreenAdj.set('kbgap',0);var d=document.getElementById('ed');if(d&&d.blur)d.blur();window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
  await sleep(1500);
}

// ① overlay 内核：瞬时收缩同拍→全高，vk 接管
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const o1 = await pollH('488px', 5000);
check('O1 overlay 内核：瞬时收缩后全高不误收，vk 实测接管停靠 488px', o1, await ev(H));

// ② overlay 内核：vk 归零＝立即收口
await ev("(function(){window.__fakeVK.boundingRect.height=0;window.__fakeVK.dispatch();return 1;})()");
const o2 = await pollH('', 2000);
check('O2 overlay 内核：vk 归零 ≤2s 收口（红侧必红＝vk 快收路径）', o2, await ev(H));

// ③ overlay 内核：点消息区＝收口（红侧无监听＝必红）
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
await pollH('488px', 4000);
await ev("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('ed');var tgt=(cb&&cb.firstElementChild)?cb.firstElementChild:cb;if(tgt)tgt.dispatchEvent(new Event('touchstart',{bubbles:true}));return 1;})()");
const o3 = await pollH('', 2000);
check('O3 overlay 内核：点消息区当场收口（红侧无监听＝必红）', o3, await ev(H));

// ④ 诚实内核：持续收缩 ≥400ms 后全高＝真收口，秒回
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const h1 = await pollH('360px', 5000);
await sleep(700); // 诚实判位（>400ms 持续收缩）
await ev("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const t4 = Date.now();
const h2 = await pollH('', 2000);
check('H1 诚实内核（持续收缩≥400ms）：全高读数＝真收口，≤2s 回位（红侧无诚实判位＝必红）', h1 && h2, { open: h1, ms: Date.now() - t4 });

// ⑤ 诚实内核：快速打字后立刻收起也秒收（400ms 门槛不误伤）
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const h3 = await pollH('360px', 5000);
await sleep(460); // 刚过 400ms 门槛（最紧用例）
await ev("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const h4 = await pollH('', 2000);
check('H2 诚实内核快用例：停手 460ms 收起仍秒回（400ms 门槛设计意图）', h3 && h4, { open: h3, closed: h4 });

// ⑥ 抖动契约：读数不变时高度纹丝不动
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
await pollH('488px', 4000);
const s1 = await ev(H);
await sleep(2000);
const s2 = await ev(H);
check('D1 止抖：读数不变 2s 内高度纹丝不动（红侧逐拍改写＝必红）', s1 === '488px' && s2 === '488px', { t0: s1, t2: s2 });

// ⑦ 高度出口全整数（无 637.333 这类小数）
check('D2 高度出口取整：实测会话内不存在小数高度', typeof s1 === 'string' && s1 === '488px', { h: s1 });

check('Z1 零 JS 异常', ERRS.length === 0, ERRS.length);
const pass = results.filter((x) => x.ok).length;
console.log('\n#1521 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill(); server.close();
process.exit(results.length - pass === 0 ? 0 : 1);
