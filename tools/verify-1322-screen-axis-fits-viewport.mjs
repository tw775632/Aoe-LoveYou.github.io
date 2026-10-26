// ===== 回归脚本：#1322 屏幕适配轴必须对自己说的话负责（HONOR Play4T/华为浏览器实报「屏幕上方会出现一片空白、
// 没有贴顶部，UI 位置错位」＋「其他设备型号也有出现，不要覆盖式修补」）=====
// 用法：node tools/verify-1322-screen-axis-fits-viewport.mjs [--root <产物目录>]（需 node 21+ 与本机 Chrome/Edge）
// 现场（两张导出件 61459ed6… ＋ 本脚本同尺复现）：屏 360×780、网页可视区 360×634，本机存着
//   手调轴 top+46 bottom+50 h+41 desk+24 shift+29 text+9。三个互不相同的事实：
//   ① 症状本体＝整体位移轴：.phone 是 relative 纯平移，盒子已贴满可视区时 shift=29 ⇒
//      顶边 29／底边 663（屏幕最上面那 29px 不是本页、最下面那 29px 滚不到）＝用户所见空白＋错位。
//   ② 尺子瞎＝期望被被测轴喂：④ 的「期望底 = expBase + shift」把 663 判成「✓ 底部贴合（底=663/期望 663）」，
//      而 ④/⑤b 又因「h=41＝用户手动微调过」整条跳过（报告原话：已手动微调 h=41px，跳过贴合判定）。
//   ③ 两根轴是死的＝跳过闸的输入本身不成立：顶部避让/页面高度两轴是「系统基准+偏移」双层，
//      该形态下没人写 --mochi-safe-top / --mochi-ios-h（实测顶 0/底 634/高 634 与七轴全 0 那一轮逐像素相同），
//      可它们的存值照样关掉两条判定；「一键修正」在此现场推荐的恰是那条死的 h（-29）＝点了没反应。
// 夹具纪律（两条都是本轮实测踩过的）：
//   · 种轴必须用 Page.addScriptToEvaluateOnNewDocument 在 paint 前写 LS，且每组先
//     Storage.clearDataForOrigin——App 的 IndexedDB 回填会在导航后盖掉刚种的 LS 裸键。
//   · 判定器的同尺 A/B 走「取真实现场 inp ＋ 只改被测数字」：window.__screenDiagJudge 已暴露，
//     两侧喂同一份合成 inp，才分得清「尺子变了」还是「现场变了」。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgIdx = process.argv.indexOf('--root');
const root = normalize((rootArgIdx > -1 ? process.argv[rootArgIdx + 1] : dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('被测根目录 =', root);
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

/* ───────── S 组：产物静态锚（与哨兵 needle 同尺） ───────── */
const html = readFileSync(join(root, 'index.html'), 'utf8');
const ma = readFileSync(join(root, 'js', 'mobile-adapt.js'), 'utf8');
const per = readFileSync(join(root, 'js', 'personalize.js'), 'utf8');
check('S1 位移轴按现场几何夹回（down/up 两把尺子都在）',
  ma.includes('eff = Math.min(eff, Math.round(rm.down));') && ma.includes('eff = Math.max(eff, -Math.round(rm.up));'));
check('S2 键盘停靠期不重算（沿用 #282 那把 22% 尺，不另起一套）',
  ma.includes('if (ih - vh >= Math.round(ih * 0.22)) return null;'));
check('S3 live()/inEffect() 暴露（判定器与面板据此分清「存过值」与「改了像素」）',
  ma.includes('live: function () {') && ma.includes("inEffect: function () { return { top: base['--mochi-safe-top'] !== undefined"));
check('S4 量不到就不动屏（维持上一次裁决）＋夹回后落 var 的是夹后值',
  ma.includes('if (!rm) return;') && ma.includes("if (eff) origSet('--mochi-shift-adj', eff + 'px');"));
check('S5 判定器读 live 折年期望、跳过闸只认生效轴',
  html.includes('const adjShift = +adjLive.shift || 0;') && html.includes('else if (adjH && hReal) add(true,') && html.includes('if (!_kbDocking && inp.isMobileDev !== false && adjH && hReal) {'));
check('S6 ④′ 三条越界判据在位（顶部空白／顶部被裁／底部越界，参照物只有可视区）',
  html.includes("add(false, '顶部空白 '") && html.includes("add(false, '顶部被裁 '") && html.includes("add(false, '底部越界 '"));
check('S7 建议只看生效轴＋会把越界的位移归零',
  html.includes("cur.h === 0 && inE.h !== false") && html.includes("cur.top === 0 && inE.top !== false") && html.includes("axis: 'shift', delta: 0"));
check('S8 报告写出「不生效」与「已按可视区收回」两笔真话',
  html.includes('function sdAdjGapStr(inp) {') && html.includes('无系统基准可偏移') && html.includes('已按可视区收回'));
check('S9 面板数值后面跟「本机不生效／已收回」',
  per.includes("' 本机不生效'") && per.includes("' 已收回'"));
check('S10 邻居旧针一字未动（#707m/#707l/#917b/#917c/#917d/#1322 不缩尺）',
  ma.includes("if (adj.shift) origSet('--mochi-shift-adj', adj.shift + 'px');")
  && html.includes('.phone { top: var(--mochi-shift-adj, 0px); }')
  && html.includes('const expB = expBase + adjShift;')
  && html.includes("'底部·已手动微调 h='")
  && html.includes('const expTB = expBase - (inp.envBottom || 0) + adjShift;'));

/* ───────── 浏览器：HONOR Play4T 现场（屏 360×780／可视区 360×634） ───────── */
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1322-' + Date.now()),
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 634, deviceScaleFactor: 2, mobile: true, touch: true, screenWidth: 360, screenHeight: 780, screenDPR: 2 });

const GEO = `(function(){
  var ph=document.querySelector('.phone'); if(!ph) return JSON.stringify({noPhone:true});
  var r=ph.getBoundingClientRect();
  var hit=document.elementFromPoint(180,5), inP=false;
  for(var e=hit;e;e=e.parentNode){ if(e===ph) inP=true; }
  var A=window.mochiScreenAdj||null;
  return JSON.stringify({
    vvH:Math.round(visualViewport.height), innerH:innerHeight, screenH:screen.height,
    top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height),
    computedTop:getComputedStyle(ph).top, topStripInPhone:inP,
    topStrip:hit?(hit.tagName+(hit.id?'#'+hit.id:'')+'.'+String(hit.className||'').split(' ')[0]):'null',
    docScrollH:document.documentElement.scrollHeight,
    varShift:document.documentElement.style.getPropertyValue('--mochi-shift-adj')||'(未设)',
    stored:A?A.all():null, live:A&&A.live?A.live():null, inEffect:A&&A.inEffect?A.inEffect():null
  });
})()`;
const ENTER = "(function(){var a=document.getElementById('splash-enter');if(a)a.click();return !!a;})()";
// 强制告知页（#splash-mandatory）的【我已阅读并确认进入】要先把该页滑到底才解锁（v3.26.x 设计），
// 不滑到底 click() 点了没反应＝开屏层一直盖着，「屏幕最上面那一条命中谁」这把尺子量的就不是现场。
const SCROLL_MAND = "(function(){var s=document.getElementById('splash-mandatory-scroll');if(s){s.scrollTop=s.scrollHeight;s.dispatchEvent(new Event('scroll'));return !!s;}return false;})()";
const ENTER2 = "(function(){var a=document.getElementById('splash-mandatory-enter');if(a&&!a.classList.contains('is-disabled'))a.click();return a?(!a.classList.contains('is-disabled')):false;})()";
async function scene(seed) {
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
  const src = "(function(){try{" + Object.keys(seed).map((k) => "localStorage.setItem('xy-home-v2:screen-adj-" + k + "'," + JSON.stringify(String(seed[k])) + ');').join('') + "}catch(e){}})();"
    + "window.__err=window.__err||[];window.addEventListener('error',function(x){window.__err.push(String(x.message).slice(0,90));});";
  const hook = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 25; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1000);
  await ev(ENTER); // 开屏两段（真机报障单里的交互轨迹同序）：先 splash-enter，再强制告知页
  await sleep(700);
  await ev(SCROLL_MAND);
  await sleep(500);
  await ev(ENTER2);
  await sleep(1200);
  const g = JSON.parse((await ev(GEO)) || '{}');
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier });
  return g;
}
const REPORT = `(function(){ try { var d=window.__collectScreenDiag(null); return JSON.stringify({ text:d.text, bad:(d.inp.bad||d.bad||null), names:d.text.split('\\n').filter(function(l){return /^✗|^⚠|\\[屏幕适配\\]|已手动微调|不生效|收回|顶部空白|底部越界|底部贴合/.test(l);}) }); } catch(e){ return JSON.stringify({err:String(e).slice(0,90)}); } })()`;
const JUDGE = `(function(){
  try {
    if(!window.__screenDiagJudge||!window.__collectScreenDiag) return JSON.stringify({noJudge:true});
    var live=window.__collectScreenDiag(null).inp;
    // 同尺合成现场：只改被测数字（顶 29/底 663/可视 634＝报障单那一发），其余全取本机真实读数
    function run(o){
      var inp=JSON.parse(JSON.stringify(live));
      var ih=o.ih||634, vh=o.vh||ih, sh=o.sh||780;
      inp.phoneTop=o.phoneTop; inp.phoneBottom=o.phoneBottom; inp.innerH=ih; inp.vvH=vh; inp.vvOffTop=0; inp.scale=1;
      inp.screenH=sh; inp.diff=sh-ih; inp.isMobileDev=true; inp.andr=true; inp.standalone=false; inp.fsActive=false;
      inp.tabBottom=o.tabBottom; inp.adj=o.adj; inp.adjLive=o.adjLive||null; inp.adjIn=o.adjIn||null;
      var F=window.__screenDiagJudge(inp);
      return { bad:F.filter(function(f){return !f.ok;}).map(function(f){return f.name.split(' ')[0]+':'+f.name;}),
               all:F.map(function(f){return (f.ok?'✓':'✗')+f.name;}) };
    }
    return JSON.stringify({
      A: run({ phoneTop:0, phoneBottom:634, tabBottom:634, adj:{top:0,bottom:0,h:0,desk:0,shift:0,text:0,side:0},
               adjLive:{top:0,bottom:0,h:0,desk:0,shift:0,text:0,side:0}, adjIn:{top:false,h:true,bottom:true,desk:true,shift:true,text:true,side:true} }),
      B: run({ phoneTop:29, phoneBottom:663, tabBottom:692, adj:{top:46,bottom:50,h:41,desk:24,shift:29,text:9,side:0},
               adjLive:{top:0,bottom:50,h:0,desk:24,shift:0,text:9,side:0}, adjIn:{top:false,h:false,bottom:true,desk:true,shift:true,text:true,side:true} }),
      C: run({ phoneTop:29, phoneBottom:663, tabBottom:692, adj:{top:0,bottom:0,h:41,desk:0,shift:29,text:0,side:0} }),
      // D＝#917 verify-diag-noise B5a 那个现场：盒子比可视区矮 37px 且被容器居中 ⇒ 顶/底各空 37px。
      //   同一条白带不许报两处（④ 的「底部少填 37px 白带」已说过），本批的顶边判据要让位。
      D: run({ ih:844, sh:844, phoneTop:37, phoneBottom:807, tabBottom:844, adj:{top:0,bottom:0,h:0,desk:0,shift:0,text:0,side:0} })
    });
  } catch(e){ return JSON.stringify({err:String(e).slice(0,120)}); }
})()`;
const SUG = `(function(){ try { return JSON.stringify((window.mochiScreenFixSuggest?window.mochiScreenFixSuggest():null)); } catch(e){ return 'ERR'; } })()`;

/* A 组：症状本体——位移轴把整页推出可视区 */
const g0 = await scene({});
check('A0 夹具真实：七轴全 0 时 .phone 顶 0／底 634＝正好贴满可视区', g0.top === 0 && g0.bottom === 634 && g0.vvH === 634 && g0.screenH === 780, JSON.stringify({ top: g0.top, bottom: g0.bottom, vvH: g0.vvH, screenH: g0.screenH }));
check('A0b 夹具真实：该形态下顶部/页面高度两轴确实没有基准可写（--mochi-safe-top/--mochi-ios-h 未设＝两根滑杆是死的）',
  await ev("(function(){var s=document.documentElement.style;return !(s.getPropertyValue('--mochi-safe-top')||s.getPropertyValue('--mochi-ios-h'));})()") === true);
const g1 = await scene({ shift: 29 });
check('A1 报障症状收口：存 shift=29 时屏上仍是顶 0／底 634（不得把整页推出去）', g1.top === 0 && g1.bottom === 634, JSON.stringify({ top: g1.top, bottom: g1.bottom, computedTop: g1.computedTop, varShift: g1.varShift }));
const g1b = await scene({});
check('A2a 夹具真实：七轴全 0 时屏幕最上面那一条（y=5）命中本页元素', g1b.topStripInPhone === true, 'topStrip=' + g1b.topStrip + ' inPhone=' + g1b.topStripInPhone);
check('A2b 报障症状收口（命中测试口径）：存 shift=29 时 y=5 那一条仍旧落在本页之内（HEAD 上它落到 .phone 之外的底色＝用户所见「一片空白」）', g1.top === 0 && g1.topStripInPhone === true, JSON.stringify({ top: g1.top, topStripInPhone: g1.topStripInPhone }));
const g3 = await scene({ shift: -29 });
check('A3 反方向同理：shift=-29 也不得把页顶推出可视区', g3.top === 0 && g3.bottom === 634, JSON.stringify({ top: g3.top, bottom: g3.bottom }));
const g4 = await scene({ top: 46, h: 41 });
check('A4 死轴读数如实：top=46+h=41 那一轮的几何与全 0 那一轮逐像素相同（＝这两轴什么都没改）',
  g4.top === g0.top && g4.bottom === g0.bottom && g4.h === g0.h, JSON.stringify({ top: g4.top, bottom: g4.bottom, h: g4.h }));
const g5 = await scene({ top: 46, bottom: 50, h: 41, desk: 24, shift: 29, text: 9 });
check('A5 报障单原样那一轮：屏上顶 0／底 634（＝用户所见的空白与裁切都不在了）', g5.top === 0 && g5.bottom === 634, JSON.stringify({ top: g5.top, bottom: g5.bottom, tabIn: g5.varShift }));
check('A6 生效性可读回：live().shift 与 all().shift 分开（存 29、落地 0），且 top/h 报不生效',
  !!g5.live && !!g5.inEffect && g5.stored.shift === 29 && g5.live.shift === 0 && g5.inEffect.top === false && g5.inEffect.h === false,
  JSON.stringify({ stored: g5.stored && g5.stored.shift, live: g5.live && g5.live.shift, inEffect: g5.inEffect }));
const rep = JSON.parse((await ev(REPORT)) || '{}');
check('A7 报告里点名两笔真话（不生效轴 + 被可视区收回的位移）', /不生效/.test(rep.text || '') && /收回/.test(rep.text || ''), (rep.names || []).join(' | ').slice(0, 220));
check('A8 报告实测段落出顶边（旧报告只有底边，「上方一片空白」在纸上无处可看）', /顶边=0px/.test(rep.text || ''), (rep.text || '').split('\n').filter((l) => l.indexOf('.phone：') === 0).join(''));

/* J 组：同一把尺子（合成 inp 喂 __screenDiagJudge）——本批改的是尺子，读数必须两侧同输入 */
const jd = JSON.parse((await ev(JUDGE)) || '{}');
check('J0 判定器与采集器都暴露（同尺前提）', !jd.noJudge && !jd.err && !!jd.A, JSON.stringify(jd).slice(0, 100));
const hasOut = (r) => /底部越界|顶部空白/.test((r.bad || []).join('|'));
const skipped = (r) => /已手动微调/.test((r.all || []).join('|'));
check('J1 健康现场不误伤：顶 0/底 634 时没有越界条目', !hasOut(jd.A) && !(jd.A.bad || []).length, (jd.A.bad || []).join(' | '));
check('J2 越界现场被点名：顶 29/底 663（可视 634）必须报「顶部空白」＋「底部越界」', hasOut(jd.B) && /顶部空白/.test((jd.B.bad || []).join('|')) && /底部越界/.test((jd.B.bad || []).join('|')), (jd.B.bad || []).join(' | '));
check('J3 死轴不得关掉底部判定：B 现场（h 存 41 而 inEffect.h=false）不再出现「已手动微调…跳过」', !skipped(jd.B), 'B跳过=' + skipped(jd.B) + ' || ' + (jd.B.bad || []).join(' | '));
check('J4 真生效的手调轴仍旧豁免（#917 那三行语义没被本批缩掉）：A 现场 adjIn.h=true 时如下结论仍按期望', !jd.A.err && (jd.A.all || []).some((l) => /^✓底部贴合/.test(l)), (jd.A.all || []).filter((l) => /底部/.test(l)).join(' | '));
check('J5 旧产物回落口径逐字保留（无 live()/inEffect() 两把尺＝沿用修前「按存值跳过」，本批不给旧包添新红）', skipped(jd.C) && !jd.C.err, 'C跳过=' + skipped(jd.C) + ' || ' + (jd.C.all || []).filter((l) => /微调/.test(l)).join(' | '));
check('J6 同一条白带不报两处（#917 B5a 现场：盒子矮 37 且顶边同样空 37 ⇒ 只报「底部少填」，顶边判据让位）', (jd.D.bad || []).length === 1 && /底部少填/.test((jd.D.bad || []).join('|')) && !/顶部空白/.test((jd.D.bad || []).join('|')), (jd.D.bad || []).join(' | '));

/* C 组：诊断→修正闭环不再把用户往死轴上引（真实现场 shift=29） */
await scene({ shift: 29 });
const sug = JSON.parse((await ev(SUG)) || 'null');
check('C0 建议可取（现场 shift=29）', Array.isArray(sug), JSON.stringify(sug));
check('C1 建议不再指向那条死的页面高度轴（HEAD 在此现场推荐 h=-29＝写了不动屏）', !(sug || []).some((s) => s.axis === 'h'), JSON.stringify(sug));
check('C2 建议点名病因轴：把整体位移归零', (sug || []).some((s) => s.axis === 'shift' && s.delta === 0), JSON.stringify(sug));
await scene({ top: 46, bottom: 50, h: 41, desk: 24, shift: 29, text: 9 });
const sug2 = JSON.parse((await ev(SUG)) || 'null');
check('C3 报障单原样那一轮给得出「归零」那一发：底部轴 50px 把导航栏抬离屏底（旧口径＝报告点名而按钮袖手，用户只能再报一次）', Array.isArray(sug2) && sug2.some((s) => s.axis === 'bottom' && s.delta === 0), JSON.stringify(sug2));
check('C4 该轮不推荐任何不生效的轴（top/h 不得出现在建议里）', Array.isArray(sug2) && !sug2.some((s) => s.axis === 'h' || s.axis === 'top'), JSON.stringify(sug2));

/* D 组：本批不是把整根轴废掉——这一格真有余量时，位移照旧落地 */
const d1 = JSON.parse((await ev(`(function(){
  var ph=document.querySelector('.phone'); if(!ph) return '{}';
  var vvH=Math.round(visualViewport.height);
  window.mochiScreenAdj.set('shift',0);
  ph.style.height=(vvH-120)+'px';                     // 造 120px 真实余量（与 App 自己收缩盒子同形态）
  var base2=Math.round(ph.getBoundingClientRect().top); // 有余量后的静止位（可能被容器居中抬一段，与位移无关）
  var ok=window.mochiScreenAdj.set('shift',29);
  var after=Math.round(ph.getBoundingClientRect().top);
  return JSON.stringify({ok:ok, moved:after-base2, live:window.mochiScreenAdj.live?window.mochiScreenAdj.live().shift:null});
})()`) || '{}'));
check('D1 有余量时位移完整落地（相对静止位恰好下移 29＝本批没把整根轴废掉；两侧皆绿才算数）', d1.ok === true && d1.moved === 29 && (d1.live === 29 || d1.live === null), JSON.stringify(d1));
const d2 = await ev(`(function(){
  var ph=document.querySelector('.phone'); ph.style.height=''; window.mochiScreenAdj.set('shift',29);
  return true;
})()`);
await sleep(2600); // 余量没了：1s 复述循环必须自己把位移收回来（不靠用户刷新）
const d3 = JSON.parse((await ev(`(function(){
  var ph=document.querySelector('.phone'); var r=ph.getBoundingClientRect();
  return JSON.stringify({top:Math.round(r.top), bottom:Math.round(r.bottom), live:window.mochiScreenAdj.live?window.mochiScreenAdj.live().shift:null});
})()`) || '{}'));
check('D2 余量消失后自我复核：不再需要用户动手，顶边回到 0 且 live=0', d2 === true && d3.top === 0 && d3.live === 0, JSON.stringify(d3));
await ev("(function(){ window.mochiScreenAdj.set('shift',0); return true; })()");

/* Z 组 */
const zerr = await ev('(window.__err||[]).length');
const allErr = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
check('Z 全程无未捕获异常', zerr === 0 && allErr === 0, 'err=' + zerr + ' jsErrors=' + allErr);

server.close();
chrome.kill();
const pass = results.filter((r) => r.ok).length;
console.log('---');
console.log('通过 ' + pass + '/' + results.length);
process.exit(pass === results.length ? 0 : 1);
