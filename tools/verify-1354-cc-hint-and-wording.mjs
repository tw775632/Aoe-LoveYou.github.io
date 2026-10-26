// ===== 常驻回归（#1354）：字卡库「选不了多张…」只在可上传图片的分类显示 ＋ 内置字卡「大众框」说明四处齐备 =====
// 用户直派（2026-09-28）：「字卡库里，只需要在可以上传图片的分类里显示【选不了多张或点了没反应…】
//   这个现在是每一个分类都显示，莫名其妙」＋「还缺少说明：系统内置字卡都是大众字卡，没有任何属性，
//   在合适的位置都加上」（措辞按用户给的 A 岛审核截图口径＝大众框（公共模板），没有任何属性；
//   口径两处追问定档＝只显示在表情包/图片两格、措辞只用原句不加解释、位置只落产品内看得见的四处）。
// 判据＝「这一格能不能上传图片」（严格＝表情包/图片两格，语音不算）；
//   文字分类的批量导入是弹窗粘贴、语音走音频路径，都谈不到「选不了多张」。链接导入按钮显隐作旧契约对照组。
// 断言两层：T＝src 静态锚（四处文案＋原句无括注＋使用说明/功能清单未被重复挂＋显隐针＋各节计数守恒）；H＝无头实跑切七个分类读 computed display。
// 用法：node tools/verify-1354-cc-hint-and-wording.mjs（MOCHI_ROOT=目录 可指向隔离副本；需本机 Chrome/Edge）
// verify-suite:timeout=120000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// 内存拼装 src（与 build.mjs 同序，不写产物）
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

let pass = 0, fail = 0;
const chk = (name, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' | ' + extra : '')); } };

// ---- T 静态锚 ----
console.log('--- T src 静态锚 ---');
const tpl = read('template.html');
const cc = read('js/chatcard.js');
chk('T1 提示那条静态 div 仍在 template（未删源、由 JS 管显隐）', tpl.includes('id="cc-import-hint"'));
chk('T2 chatcard 按「这一格可否上传图片」管提示显隐', /const img = cur === 'sticker' \|\| cur === 'image';/.test(cc) && /if \(h\) h\.style\.display = img \? '' : 'none';/.test(cc));
chk('T3 显隐同步挂在切分类与进页两处（syncLinkImportVis 既有调用点）', (cc.match(/syncLinkImportVis\(\);/g) || []).length === 2);
const SENT = '系统内置字卡都是大众框（公共模板），没有任何属性';
const pers = read('js/personalize.js'), sh = read('js/settings-help.js');
const hits = (s) => (s.split(SENT).length - 1);
chk('T4 字卡库·系统预设分区顶部说明在位', hits(tpl) === 1, 'hits=' + hits(tpl));
chk('T5 关于·常见问题两条弹窗都带上（怎么添加字卡 / 系统预设字卡与功能设置）', hits(pers) === 2, 'hits=' + hits(pers));
chk('T6 这两行的功能说明胶囊短版同步（settings-help 同口径镜像）', hits(sh) === 2, 'hits=' + hits(sh));
chk('T7 措辞＝审核截图原句，未追加解释性括注（用户选「只用你的原句」）', hits(tpl) + hits(pers) + hits(sh) === 5
  && ![tpl, pers, sh].some((s) => /也不带 CP|不指向任何角色|通用模板/.test(s)));
chk('T8 使用说明／关于功能清单刻意不重复（用户选「只产品内」＝第 7 节仍 16 条、02 字卡系统那行原样）',
  tpl.includes('<span class="lg-name">常见问题</span><span class="lg-count">16</span>') && tpl.includes('系统预设字卡（自搓）可逐句开关</div>'));
// 计数守恒：使用说明第 7 节 lg-count 与实际条目数一致（verify-guide-help G2 同款口径）
const gseg = tpl.slice(tpl.indexOf('id="page-guide"'));
let bad = [];
const re = /<summary><span class="lg-num">(\d+)<\/span><span class="lg-name">([^<]+)<\/span><span class="lg-count">(\d+)<\/span><\/summary>([\s\S]*?)<\/details>/g;
let m;
while ((m = re.exec(gseg))) { const items = (m[4].match(/class="lic-li"/g) || []).length; if (items !== Number(m[3])) bad.push(m[2] + ':' + m[3] + '≠' + items); }
chk('T9 使用说明各节计数与条目数一致', bad.length === 0, bad.join(' '));

// ---- 无头实跑 ----
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('环境不满足：找不到 Chrome/Edge'); process.exit(2); }
const cdpPort = 9930 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-hint-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {} });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const mm = JSON.parse(ev.data); if (mm.id && pend.has(mm.id)) { pend.get(mm.id)(mm.result); pend.delete(mm.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接 CDP'); process.exit(2); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const ev = async (expr) => { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.exceptionDetails ? null : (r && r.result ? r.result.value : null); } catch (e) { return null; } };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(700);
await ev("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return true;})()");
const clearGates = () => ev("(function(){['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'].forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
await clearGates(); await sleep(200);
// 进字卡库（正规入口：专属字卡行 → openCcPage）
await ev("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
await sleep(1800); await clearGates();

const probe = () => ev(`(function(){
  var h=document.getElementById('cc-import-hint'), b=document.getElementById('cc-import-link'), t=document.querySelector('.cc-tab.sel');
  var vis=function(e){ if(!e) return 'no-el'; var cs=getComputedStyle(e); return (cs.display!=='none' && cs.visibility!=='hidden'); };
  return JSON.stringify({ tab:t?t.dataset.type:null, hint:vis(h), link:vis(b) });
})()`);

console.log('--- H 无头实跑：切每个分类读提示显隐（link 按钮＝旧契约对照组） ---');
const CASES = [
  ['text', true, true], ['kaomoji', true, true], ['emoji', true, true],
  ['poke', true, true], ['sticker', false, false], ['image', false, false], ['voice', true, true]
];
for (const [type, hintHidden, linkHidden] of CASES) {
  await ev(`(function(){var t=document.querySelector('.cc-tab[data-type=${type}]');if(t)t.click();return !!t;})()`);
  await sleep(900); await clearGates();
  const j = JSON.parse(await probe() || '{}');
  chk(`H ${type}：提示 ${hintHidden ? '隐藏' : '显示'}`, j.hint === !hintHidden, JSON.stringify(j));
  chk(`H ${type}：链接导入按钮 ${linkHidden ? '隐藏' : '显示'}（旧契约未动）`, j.link === !linkHidden, JSON.stringify(j));
}
const errs = await ev('(window.__jsErrors || []).slice(0,6)');
chk('H Z 零 window 报错', !errs || errs.length === 0, errs && errs.length ? JSON.stringify(errs).slice(0, 300) : '');

console.log('\n===== ' + pass + ' 过 / ' + fail + ' 挂 =====');
process.exit(fail ? 1 : 0);
