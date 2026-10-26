(function () { try {
/* ===== 功能：入站须知（开屏公告前的一次性入站确认层 · 答对全部题并接受规则才能看公告） =====
归属：开屏/入口验证（AI-B 域）。build.mjs jsFiles 插在 entry-quiz.js 之后加载。
触发：模块加载即判定——开屏（#splash）在场且本机未通过时，立即在 .splash 内盖上整页
须知（.eqz-active 收起 .splash-box/.splash-footcard，同 entry-quiz 的同层方案）；
通过后移除本层，开屏公告照常出现。clock.js 的进入流程（含 #1550 的 24 题入站
问卷闸 mochiEntryQuizGate）一字未动，两道闸完全独立。
页面：作为 .splash 容器内的整页子节点（复用 entry-quiz.css 的 .eqz-* 样式，零新 CSS），
与开屏同层（.splash 的 z-index 999），不新建遮罩、不改任何图层/z-index。
没有返回/关闭入口：不接受须知＝无法查看公告（想离开直接关掉页面）。
数据：全局根键 xy-home-v2:rules-notice-pass（存 {t:时间戳, v:须知版本}；已进 contacts.js EXCLUDE）。
全对并点「最终确认」＝本机永久放行；须知内容改版（RULES_VER 变化）后自动失效＝重新确认一次。
放行判定同 #1572 口径：记录版本 ≥ 本页版本即放行（防 SW cache-first 版本乒乓反复重答）。
内容：作者 2026-10-22 直派《本站入站须知》原文——规则声明两段＋「入站氛围确认」8 题单选
（答案 1B 2B 3B 4A 5C 6A 7B 8A，页面明文不含答案）＋最终确认按钮。
自动化：无头/回归环境（webdriver / Headless UA）直接放行，避免回归脚本被挡在公告之外。
====================================================== */
(function () {
'use strict';
const G = 'xy-home-v2';
const K_PASS = 'rules-notice-pass';
const RULES_VER = '2026-10-22c';
const IS_AUTOMATION = (typeof navigator !== 'undefined') &&
(navigator.webdriver === true || /Headless/i.test(String(navigator.userAgent)));
function gGet(k) {
try { const v = window.xyStore ? window.xyStore(G).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
try { return localStorage.getItem(G + ':' + k); } catch (e2) { return null; }
}
function gSet(k, v) {
try { if (window.xyStore) window.xyStore(G).set(k, v); else localStorage.setItem(G + ':' + k, v); }
catch (e) { try { localStorage.setItem(G + ':' + k, v); } catch (e2) {} }
}
/* #1585（2026-10-23 作者报「iQOO 11 / Edge，8 道题答了 10 遍，每次重开都要重答」）：
这不是机型玄学，是**本页自己的时序 bug**——24 题问卷一直正常就是铁证：
· 24 题问卷的闸在「点进入」时判（那时 idbRestore 已完成，同步口读得到记录）；
· 本页的闸在**模块加载瞬间**判（idbRestore 还没回填完）。
于是：只要这台机器的 localStorage 写不进/被清（本仓 idb.js #1309a 已实锤 Edge/小米 14U
出现过「LS 整域写不进、站内 0 键，全站只剩 IDB 一份拷贝」），记录就只存在于 IndexedDB，
而启动回填是异步的、比本模块晚 ⇒ 开门那一刻同步读空 ⇒ 判成「没答过」⇒ 天天重答。
修法（三路冗余 + 异步确认）：
① cookie：同步可读、独立配额、不参与 LS 配额争抢，作为第一判据（新记录同时写它）；
② 内存/LS：原有通道（回填完成后同步命中）；
③ IndexedDB：开层前先异步问一次库，并监听 mochi-restore-done 再核一次——
「同步读空 ≠ 没记录」，只有三路都否定才盖层；证据迟到了（已盖层）则当场自动收层。
cookie 只存版本号，不含任何用户数据；伪造它等于伪造 localStorage，安全级别一致。 */
const CK = 'mochi_rnp';
function ckRaw() {
try {
const m = document.cookie.match(/(?:^|;\s*)mochi_rnp=([^;]*)/);
return m ? decodeURIComponent(m[1]) : null;
} catch (e) { return null; }
}
function ckSet(ver) {
try { document.cookie = CK + '=' + encodeURIComponent(ver) + '; path=/; max-age=63072000; SameSite=Lax'; } catch (e) {}
}
function verCmp(a, b) {
const sa = String(a == null ? '' : a), sb = String(b == null ? '' : b);
if (sa === sb) return 0;
const ma = sa.match(/^(\d{4}-\d{2}-\d{2})(.*)$/), mb = sb.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
if (!ma || !mb) return sa > sb ? 1 : -1;
if (ma[1] !== mb[1]) return ma[1] > mb[1] ? 1 : -1;
const ta = ma[2] || '', tb = mb[2] || '';
if (ta === tb) return 0;
return ta > tb ? 1 : -1;
}
function recOk(raw) {
if (raw === null || raw === undefined) return false;
if (typeof raw !== 'string') {
try { return !!(raw && typeof raw.v === 'string' && raw.v && verCmp(raw.v, RULES_VER) >= 0); } catch (e0) { return false; }
}
if (raw.charAt(0) !== '{') return false;
try {
const o = JSON.parse(raw);
return !!(o && typeof o.v === 'string' && o.v && verCmp(o.v, RULES_VER) >= 0);
} catch (e) { return false; }
}
function passed() {
if (IS_AUTOMATION) return true;
const ck = ckRaw();
if (ck && verCmp(ck, RULES_VER) >= 0) {
try { if (!recOk(gGet(K_PASS))) gSet(K_PASS, JSON.stringify({ t: Date.now(), v: ck })); } catch (e1) {}
return true;
}
try {
if (recOk(gGet(K_PASS))) {
if (!ck || verCmp(ck, RULES_VER) < 0) ckSet(RULES_VER);
return true;
}
} catch (e2) {}
return false;
}
function markPassed() {
const val = JSON.stringify({ t: Date.now(), v: RULES_VER });
ckSet(RULES_VER);                     // ① cookie
gSet(K_PASS, val);                    // ② 内存 + LS（xyStore 会同时写 IDB）
try { if (!window.xyStore && window.idbSet) window.idbSet(G + ':' + K_PASS, val); } catch (e) {}
}
const RULE_PARA1 = '本站是个人维护的免费站点。为了维护良好的使用体验，请遵守以下基本规则：分享链接需注明作者署名，禁止将本站与其他站点进行对比拉踩，禁止泄露问卷答案和开屏密码。';
const RULE_PARA2 = '可能很多人觉得免费就不该有规矩。但这是个人花心血做的同好自留地。任何圈子，人一多、风气一杂，原本那种安静稳定的体验就毁了。规则和门槛的存在，只是为了保护正常使用的人能有个好环境。如果觉得规矩多、嫌麻烦，说明这里可能不适合你，大家双向选择就好。继续即视为接受。';
const QUESTIONS = [
{ q: '这个网站免费给你用，但它是作者花钱花时间做的。你平时会怎么使用？',
o: ['随便用用，反正不要钱', '正常使用，按站内规则来', '免费的东西还定规矩，用的人多了作者自己就该受着'], a: 1 },
{ q: '作者花了大量时间精力维护这个网站，你对此的态度是？',
o: ['关我什么事', '知道维护不容易，会正常配合'], a: 1 },
{ q: '你认同「免费的东西也要有底线」吗？',
o: ['没想过', '认同，免费也有基本规则', '不认同，都免费了还要求这要求那'], a: 1 },
{ q: '你觉得网站设置「门槛」存在的意义是什么？',
o: ['让合适的人留下，让不合适的人离开', '故意不让人用', '显得自己很特别'], a: 0 },
{ q: '如果有人建议你「不用管规则直接进」，你会？',
o: ['有这种好事？怎么进', '无所谓，能进就行', '还是按规则来，别给作者添麻烦'], a: 2 },
{ q: '本站设门槛，是为了保护原本同频的氛围。你更希望这里的未来是？',
o: ['保持稳定长久，大家安安静静、开开心心地用', '人越多越好，越热闹越乱才好玩', '无所谓，反正我只是个过客'], a: 0 },
{ q: '你会拿一个网站去踩另一个网站吗？大家都是为爱发电免费做的，都是心血。',
o: ['看情况，好用就夸，不好用就踩', '不会，没必要比较', '不好用就踩，反正言论自由，踩了又怎样'], a: 1 },
{ q: '开屏已声明：本站不适合未成年人，且需要遵守一定规则。如果觉得规矩多、嫌麻烦，建议慎重使用。你是否已了解？',
o: ['了解，我愿意遵守规则并对自己负责', '没注意，跳过了', '了解，但我觉得太麻烦了'], a: 0 }
];
function esc(s) {
return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(msg) {
try { if (window.toast) { window.toast(msg); return; } } catch (e) {}
}
let pageEl = null;
function cleanup() {
const sp = document.getElementById('splash');
if (sp) {
sp.classList.remove('eqz-active');
sp.classList.remove('rules-open');
try { sp.scrollTop = 0; } catch (e0) {}
}
if (pageEl && pageEl.parentNode) pageEl.parentNode.removeChild(pageEl);
pageEl = null;
}
function open() {
const sp = document.getElementById('splash');
if (!sp) return; // 没有开屏（已在应用内）→ 不拦
if (pageEl && pageEl.parentNode) return; // 已打开则不重绘
const total = QUESTIONS.length;
const picks = QUESTIONS.map(function () { return null; });
let rows = '';
QUESTIONS.forEach(function (it, i) {
let opts = '';
it.o.forEach(function (txt, j) {
opts += '<button type="button" class="eqz-opt eqz-radio" data-i="' + i + '" data-j="' + j + '">' +
'<span class="eqz-opt-t">' + esc(txt) + '</span></button>';
});
rows += '<div class="eqz-q" data-i="' + i + '">' +
'<div class="eqz-qh"><span class="eqz-idx">' + (i + 1) + '.</span>' +
'<span class="eqz-tag">单选</span>' + esc(it.q) + '</div>' +
opts + '</div>';
});
const el = document.createElement('div');
el.className = 'eqz-page';
el.id = 'entry-rules-page';
el.innerHTML =
'<div class="eqz-view" id="nrz-view-quiz">' +
'<div class="eqz-scroll" id="nrz-scroll">' +
'<div class="eqz-head" id="nrz-intro">' +
'<div class="eqz-title">本站入站须知</div>' +
'<button type="button" id="nrz-diag-btn" style="margin:8px 0 2px;padding:6px 10px;font-size:11.5px;line-height:1.4;border:1px dashed currentColor;border-radius:8px;background:transparent;color:inherit;opacity:.72;cursor:pointer;touch-action:manipulation">显示不全 / 看不到第 8 题？点这里自检</button>' +
'<pre id="nrz-diag" hidden style="margin:8px 0 0;padding:10px;max-height:210px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:10.5px;line-height:1.55;background:rgba(127,127,127,.12);border-radius:8px"></pre>' +
'<div class="eqz-sub">' + esc(RULE_PARA1) + '</div>' +
'<div class="eqz-sub">' + esc(RULE_PARA2) + '</div>' +
'<div class="eqz-sub">完成下面「入站氛围确认」的全部题目并接受规则，即可继续进入开屏公告。本确认只需完成一次：通过后本机会记住，以后打开不再出现（仅当须知内容更新后才会重新出现一次）。</div>' +
'</div>' +
rows +
'<div class="eqz-q" id="nrz-final"><div class="eqz-qh"><span class="eqz-idx">最终确认</span></div>' +
'<div class="eqz-sub">我已阅读并接受以上规则。点击下方按钮提交确认，全部符合须知要求即可继续进入开屏公告。</div></div>' +
'</div>' +
'<div class="eqz-foot">' +
'<div class="eqz-progress" id="nrz-progress">已答 0 / ' + total + '</div>' +
'<div class="eqz-note" id="nrz-note">作答过程不显示对错；提交后如未全部符合要求，会告知哪些题需要重新确认（页面不会泄露答案）。</div>' +
'<div id="nrz-step" style="font-size:11.5px;line-height:1.5;margin-bottom:7px;opacity:.72">第 1 / ' + (total + 2) + ' 步 · 规则说明</div>' +
'<div style="display:flex;gap:8px;align-items:stretch">' +
'<button type="button" class="eqz-btn" id="nrz-prev" style="flex:0 0 32%;background:transparent;color:inherit;border:1px solid currentColor;opacity:.72">上一步</button>' +
'<button type="button" class="eqz-btn" id="nrz-confirm" style="flex:1">开始确认 →</button>' +
'</div>' +
'</div></div>' +
'<div class="eqz-view" id="nrz-view-result" hidden></div>';
sp.appendChild(el);
sp.classList.add('eqz-active');
sp.classList.add('rules-open');
pageEl = el;
/* #1583（作者：别再猜）——页头自检：点一下把本机真实几何数值摊开、可复制回传。
只读布局数值（不含任何聊天/账号数据），用于把「看不到第 8 题」从猜测变成可核对的现场。 */
const diagBtn = el.querySelector('#nrz-diag-btn');
const diagPre = el.querySelector('#nrz-diag');
function boxInfo(sel) {
const n = document.querySelector(sel);
if (!n) return sel + ': (无)';
const r = n.getBoundingClientRect();
const cs = getComputedStyle(n);
return sel + ': top=' + Math.round(r.top) + ' bottom=' + Math.round(r.bottom) + ' h=' + Math.round(r.height) +
' | scrollH=' + n.scrollHeight + ' clientH=' + n.clientHeight + ' scrollTop=' + Math.round(n.scrollTop) +
' | pos=' + cs.position + ' height=' + cs.height + ' minH=' + cs.minHeight +
' overflowY=' + cs.overflowY + ' flex=' + cs.flex + ' display=' + cs.display;
}
function varOf(name) {
try {
var q = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
return q || '(未设)';
} catch (e) { return '?'; }
}
if (diagBtn) diagBtn.addEventListener('click', function () {
const vv = window.visualViewport;
const sv = document.getElementById('splash-ver');
const sp = document.getElementById('splash');
const q8 = el.querySelectorAll('.eqz-q')[7];
const cbtn = el.querySelector('#nrz-confirm');
let probe = '未测';
try {
if (sp) {
const before = Math.round(sp.scrollTop);
sp.scrollTop = sp.scrollHeight;
probe = before + ' → ' + Math.round(sp.scrollTop) + ' / 上限 ' + (sp.scrollHeight - sp.clientHeight);
}
} catch (e5) { probe = 'err'; }
function rectOf(n) {
if (!n) return '无';
const r = n.getBoundingClientRect();
return 'top=' + Math.round(r.top) + ' bottom=' + Math.round(r.bottom) + ' h=' + Math.round(r.height);
}
const lines = [
'构建: ' + (sv ? sv.getAttribute('data-version') + ' / ts ' + sv.getAttribute('data-build-ts') : '无'),
'UA: ' + navigator.userAgent,
'屏幕: ' + screen.width + 'x' + screen.height + ' dpr' + (window.devicePixelRatio || 1),
'inner: ' + window.innerWidth + 'x' + window.innerHeight +
' | visualViewport: ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) + ' offTop=' + Math.round(vv.offsetTop) + ' scale=' + vv.scale : '无'),
'docEl: clientH=' + document.documentElement.clientHeight + ' scrollH=' + document.documentElement.scrollHeight +
' | body: clientH=' + document.body.clientHeight + ' scrollH=' + document.body.scrollHeight,
'变量: --mochi-vv-h=' + varOf('--mochi-vv-h') + ' --mochi-safe-top=' + varOf('--mochi-safe-top') +
' --mochi-safe-bottom=' + varOf('--mochi-safe-bottom'),
boxInfo('#splash'),
boxInfo('#entry-rules-page'),
boxInfo('#nrz-view-quiz'),
boxInfo('#nrz-scroll'),
'第8题: ' + rectOf(q8),
'确认按钮: ' + rectOf(cbtn),
'置底尝试: ' + probe,
'记录: LS=' + (function () { try { return localStorage.getItem(G + ':' + K_PASS) || '空'; } catch (e7) { return '读失败'; } })() +
' | cookie=' + (ckRaw() || '空'),
'LS可写: ' + (function () {
try {
const k = G + ':__rnp-wt';
localStorage.setItem(k, '1');
const ok = localStorage.getItem(k) === '1';
localStorage.removeItem(k);
return ok ? '可写' : '写不进';
} catch (e8) { return '写不进(' + (e8 && e8.name ? e8.name : 'err') + ')'; }
})(),
'存储用量: ' + (function () { return window.__rnpQuota || '读取中…'; })(),
'—— 请把以上全部内容复制/截图发给作者 ——'
];
diagPre.hidden = false;
diagPre.textContent = lines.join('\n');
try {
if (navigator.storage && navigator.storage.estimate) {
navigator.storage.estimate().then(function (est) {
const q = '约 ' + Math.round((est.usage || 0) / 1048576) + 'MB / 上限 ' + Math.round((est.quota || 0) / 1048576) + 'MB';
window.__rnpQuota = q;
try { diagPre.textContent = diagPre.textContent.replace('读取中…', q); } catch (e11) {}
}, function () {});
}
} catch (e10) {}
try {
if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(diagPre.textContent);
else {
const rg = document.createRange(); rg.selectNodeContents(diagPre);
const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
}
} catch (e6) {}
});
const progressEl = el.querySelector('#nrz-progress');
function refreshProgress() {
let n = 0;
picks.forEach(function (p) { if (p !== null) n++; });
if (progressEl) progressEl.textContent = '已答 ' + n + ' / ' + total;
}
el.addEventListener('click', function (e) {
const o = e.target && e.target.closest ? e.target.closest('.eqz-opt') : null;
if (!o || !el.contains(o)) return;
const i = parseInt(o.getAttribute('data-i'), 10);
const j = parseInt(o.getAttribute('data-j'), 10);
if (!QUESTIONS[i] || isNaN(i) || isNaN(j)) return;
if (picks[i] === j) return;
picks[i] = j;
Array.prototype.forEach.call(o.parentNode.querySelectorAll('.eqz-opt'), function (s) {
s.classList.toggle('is-sel', s === o);
});
refreshProgress();
});
const scrollEl = el.querySelector('#nrz-scroll');
/* #1583 一题一屏（作者：要覆盖全部机型）。
为什么：前两次都赌「某内核的滚动/高度算错」，改完仍有人在个别机型上到不了第 8 题。
现在不再依赖滚动：整页任何时刻只有一屏内容（规则说明 / 单题 / 最终确认），
底部操作条（上一步·下一步/提交）是 .eqz-view 的固定子元素、永远不参与滚动——
即便某台机器内层滚动完全失效、或可视区被地址栏/系统字体挤到只剩半屏，
用户也能靠按按钮逐题走完，第 8 题与提交按钮都必然可达。滚动只作为「内容超高」时的兜底。 */
let step = 0;                 // 0＝规则说明，1..total＝第 n 题，total+1＝最终确认
const LAST_STEP = total + 1;
const introEl = el.querySelector('#nrz-intro');
const finalEl = el.querySelector('#nrz-final');
const stepEl = el.querySelector('#nrz-step');
const prevBtnEl = el.querySelector('#nrz-prev');
function renderStep() {
if (introEl) introEl.hidden = step !== 0;
Array.prototype.forEach.call(el.querySelectorAll('.eqz-q[data-i]'), function (q) {
q.hidden = (parseInt(q.getAttribute('data-i'), 10) + 1) !== step;
});
if (finalEl) finalEl.hidden = step !== LAST_STEP;
if (prevBtnEl) prevBtnEl.disabled = step === 0;
const go = el.querySelector('#nrz-confirm');
if (go) {
go.textContent = step === 0 ? '开始确认 →'
: (step === LAST_STEP ? '我已阅读并接受以上规则，继续。' : '下一题 →');
}
if (stepEl) {
stepEl.textContent = '第 ' + (step + 1) + ' / ' + (LAST_STEP + 1) + ' 步 · ' +
(step === 0 ? '规则说明' : (step === LAST_STEP ? '最终确认' : '第 ' + step + ' 题 / 共 ' + total + ' 题'));
}
if (scrollEl) { try { scrollEl.scrollTop = 0; } catch (e4) {} }
const sp3 = document.getElementById('splash');
if (sp3) { try { sp3.scrollTop = 0; } catch (e5) {} }
refreshProgress();
}
function switchView(showResult) {
const vq = el.querySelector('#nrz-view-quiz');
const vr = el.querySelector('#nrz-view-result');
if (vq) vq.hidden = showResult;
if (vr) vr.hidden = !showResult;
el.classList.toggle('is-result', !!showResult);
if (scrollEl) scrollEl.scrollTop = 0;
const sp2 = document.getElementById('splash');
if (sp2) { try { sp2.scrollTop = 0; } catch (e3) {} }
}
function retry() {
for (let i = 0; i < picks.length; i++) picks[i] = null;
Array.prototype.forEach.call(el.querySelectorAll('.eqz-opt.is-sel'), function (o) { o.classList.remove('is-sel'); });
switchView(false);
step = 0; // #1583 一题一屏：重答从「规则说明」重新开始
renderStep();
}
function confirmRules() {
const bads = [];
QUESTIONS.forEach(function (it, i) {
if (picks[i] === null) bads.push({ n: i + 1, empty: true });
else if (picks[i] !== it.a) bads.push({ n: i + 1, empty: false });
});
const vr = el.querySelector('#nrz-view-result');
if (!vr) return;
if (bads.length) {
let list = '';
bads.forEach(function (b) {
list += '<div class="eqz-rs-li"><span class="eqz-rs-n">第 ' + b.n + ' 题</span>' +
(b.empty ? '未作答' : '单选 · 本题只有 1 个正确答案') + '</div>';
});
vr.innerHTML =
'<div class="eqz-rs eqz-rs-bad">' +
'<div class="eqz-rs-t">还有 ' + bads.length + ' 题需要重新确认</div>' +
'<div class="eqz-rs-d">作答过程不显示对错，结果在这里统一告知。以下题目未作答或与须知要求不符（页面不会泄露答案，请按须知内容重新确认）：</div>' +
'<div class="eqz-rs-list">' + list + '</div>' +
'<div class="eqz-rs-d">点「重新确认」会清空全部已选、从头再答。</div>' +
'<button type="button" class="eqz-btn" id="nrz-retry">重新确认</button>' +
'</div>';
const rt = vr.querySelector('#nrz-retry');
if (rt) rt.addEventListener('click', retry);
switchView(true);
return;
}
markPassed();
toast('已接受本站入站须知，欢迎使用');
cleanup();
}
const btn = el.querySelector('#nrz-confirm');
if (btn) btn.addEventListener('click', function () {
if (step < LAST_STEP) { step++; renderStep(); return; }
confirmRules();
});
if (prevBtnEl) prevBtnEl.addEventListener('click', function () {
if (step > 0) { step--; renderStep(); }
});
renderStep();
el.__untouched = function () { return step === 0 && picks.every(function (p) { return p === null; }); };
}
let askedOpen = false;
function openOnce() { if (askedOpen) return; askedOpen = true; open(); }
function boot() {
try {
if (passed()) return;                                   // 同步三路（cookie/内存/LS）已命中
if (!document.getElementById('splash')) return;          // 没有开屏（已在应用内）→ 不拦
/* #1585：同步读空 ≠ 没有记录。先异步问库 + 等回填事件，超时兜底照常盖层；
证据若迟到（层已盖上）且用户还没动过任何选项 → 当场收层，不再让人白答。 */
let done = false;
function acceptPass() {
if (done) return;
done = true;
try { markPassed(); } catch (e0) {}
let untouched = false;
try { untouched = !!(pageEl && pageEl.__untouched && pageEl.__untouched()); } catch (e1) {}
if (untouched) {
try { cleanup(); } catch (e2) {}
toast('本机已确认过入站须知，无需重复作答');
}
}
function ask() { if (done) return; done = true; openOnce(); }
try {
if (window.idbGet) {
Promise.resolve(window.idbGet(G + ':' + K_PASS)).then(function (v) {
if (recOk(v)) acceptPass(); else ask();
}, function () { ask(); });
}
} catch (e3) {}
try {
document.addEventListener('mochi-restore-done', function () {
if (passed()) acceptPass(); else ask();
}, { once: true });
if (window.__mochiDataReady && passed()) acceptPass();
} catch (e4) {}
setTimeout(function () { if (!done) { if (passed()) acceptPass(); else ask(); } }, 1200);
} catch (e) { try { open(); } catch (e2) { /* 任何异常都不阻塞开屏本身 */ } }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
window.__entryRulesReady = true;
window.__entryRulesTest = {
ver: RULES_VER,
list: function () { return QUESTIONS.map(function (it) { return { q: it.q, n: it.o.length, a: it.a }; }); },
reset: function () { try { localStorage.removeItem(G + ':' + K_PASS); } catch (e) {} },
pass: function () { markPassed(); }
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("entry-rules.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("entry-rules.js"); try { console.error("[JS] entry-rules.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[entry-rules.js] " + String(__e && __e.message || __e)); } })();