(function () { try {
(function () {
const ls = window.activeStore();
const DATA = window.FAV_REASON_DATA || { groups: [], cards: [] };
const HIST_KEY = 'fav-reason-history';
const RECENT = 3; // 最近 N 个分组不重复抽取
function getHistory() {
try {
const v = JSON.parse(ls.get(HIST_KEY) || '[]');
return Array.isArray(v) ? v.slice(-RECENT) : [];
} catch (e) { return []; }
}
function pushHistory(g) {
if (!g) return;
try {
const h = getHistory();
h.push(g);
ls.set(HIST_KEY, JSON.stringify(h.slice(-RECENT)));
} catch (e) {}
}
function isCardOff(g, c) {
try { return ls.get('fr-off-' + g + ':' + c) === '1'; } catch (e) { return false; }
}
function pick() {
const groups = (DATA.groups || []).filter(g =>
(DATA.cards || []).some(c => c.group === g.group && !isCardOff(g.group, c.content)));
if (!groups.length) return null;
const history = getHistory();
let pool = groups.filter(g => history.indexOf(g.group) < 0);
if (!pool.length) return null;
const total = pool.reduce((a, g) => a + Math.max(0, g.weight || 1), 0);
if (total <= 0) return null;
let roll = Math.random() * total;
let sel = pool[pool.length - 1];
for (let i = 0; i < pool.length; i++) {
roll -= Math.max(0, pool[i].weight || 1);
if (roll < 0) { sel = pool[i]; break; }
}
const cards = (DATA.cards || []).filter(c => c.group === sel.group && !isCardOff(sel.group, c.content));
if (!cards.length) return null;
const c = cards[Math.floor(Math.random() * cards.length)];
pushHistory(sel.group);
return { content: c.content, group: sel.group };
}
window.favReasonPick = function () {
try {
const r = pick();
return (r && r.content) ? r.content : '';
} catch (e) { return ''; }
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("fav-reason.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("fav-reason.js"); try { console.error("[JS] fav-reason.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[fav-reason.js] " + String(__e && __e.message || __e)); } })();