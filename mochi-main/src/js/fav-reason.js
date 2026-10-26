// ===== 【收藏原因】抽取器 =====
// 需求：联系人（TA）收藏我发的消息时，要能带一句「收藏原因」，在收藏页与聊天里的
// 【已收藏】tag 上可点开查看。本模块只负责「按分组权重 + 同类冷却抽一句」，
// 不负责决定何时收藏（何时收藏由 chat.js 的 ta-msg/ta-card 概率闸把关）。
// 与 ta-mood.js 同构：分组权重加权抽取 + 最近 N 组不重复（同类冷却）。
// 不设总冷却：一次回复只可能触发一次收藏，再加冷却只会让理由重复率变高、命中率变低。
// 不接二级密码锁（#319）：理由文案属互动链，与 TA的心情/聊天回应同为豁免项。
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

  // 单卡开关：与 ta-mood 同口径（整组停用 presetGroup.isOff('tm',…) 那套是心情链专用，
  // 这里收藏理由不接字卡库管理页的分组停用，只留逐条开关位 fr-off-<group>:<content>，
  // 以便将来字卡库接入时不必改调用方）。
  function isCardOff(g, c) {
    try { return ls.get('fr-off-' + g + ':' + c) === '1'; } catch (e) { return false; }
  }

  function pick() {
    const groups = (DATA.groups || []).filter(g =>
      (DATA.cards || []).some(c => c.group === g.group && !isCardOff(g.group, c.content)));
    if (!groups.length) return null;

    const history = getHistory();
    let pool = groups.filter(g => history.indexOf(g.group) < 0);
    // 全部进冷却时不回退到全集（宁可这一发不给理由，也不要「刚抽过的组又来一遍」）
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

  // 给 chat.js 用：只取文案，失败返回 ''（调用方按「可能没有原因」处理，
  // 不能因为抽不到就让整条收藏失败——收藏本身才是主功能，理由是加分项）。
  window.favReasonPick = function () {
    try {
      const r = pick();
      return (r && r.content) ? r.content : '';
    } catch (e) { return ''; }
  };
})();