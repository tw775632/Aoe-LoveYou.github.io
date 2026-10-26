/* ===== 功能：入站问卷（开屏「点击进入」后跳转的页面 · 答对全部题才能进入） =====
   归属：开屏/入口验证（AI-B 域）。build.mjs jsFiles 插在 clock.js 之后加载。
   触发：clock.js 的 finishEnter（点【我已阅读并知晓】/【仍要进入】的收尾）调用
        window.mochiEntryQuizGate(finishEnter)；已放行则原样放行，未放行则跳转到问卷页。
   页面（不是弹层）：问卷作为 .splash 容器内的一个整页子节点（.eqz-page），
        显示期间给 #splash 挂 .eqz-active、把 .splash-box / .splash-footcard 收起——
        与开屏同层（.splash 的 z-index 999），不新建遮罩、不改任何图层/z-index。
   数据：全局根键 xy-home-v2:entry-quiz-pass（存 {t:时间戳, v:问卷版本}；已进 contacts.js EXCLUDE）。
        答对全部题＝本机永久放行；问卷内容改版（QUIZ_VER 变化）后自动失效＝需重新作答一次。
   题库：全部 24 题（单选/多选），首位 1 题为「本站内容与功能使用」（作者 2026-10-16 直派新增），
       其后 22 题沿用作者《Mochi 字卡网站规则认知测试》原文（#1562 起原第 9/10 题合并为一道多选），
       末位 1 题为公告第 8 章「电子网站会连上鬼」传闻（作者 2026-10-15 改写，见 #1551）。
   自动化：无头/回归环境（webdriver / Headless UA）直接放行，避免 278 个回归脚本被挡在门外。
   无法关闭：没有取消入口，只能答对（明文不含答案，选项即题面）。
   ====================================================== */
(function () {
  'use strict';
  const G = 'xy-home-v2';
  const K_PASS = 'entry-quiz-pass';
  // 2026-10-15 #1553：问卷内容改了（删第 24 题干扰项 + 答错内联反馈），按「问卷改版后重答一次」的产品规则升版
  // 2026-10-16 #1554：又改了题目文字（第 5 题加「等等问题」、第 20 题删发泄相关表述、第 17/20 题去情绪化表述只留规则），再升版
  // 2026-10-16 #1555：第 6 题题干措辞对齐公告新补的 App 说明，再升版
  // 2026-10-16 #1556：交互改版——答题页不显示对错，提交后跳结果页（错题列表＋多选答案数）；结果页可「再答一次」（清空重答）或「返回开屏」；页头左上角随时可返回开屏；通过页明示「只需答一次」
  // 2026-10-16 #1559（作者直派）：新增第 1 题「本站内容与功能使用」（6 正确项 + 1 干扰项，排在首位），题库 24→25 题，再升版
  // 2026-10-16 #1562（作者直派）：原第 9 题（安卓设备问题处理）与第 10 题（会不会做成 App）合并为一道多选，题库 25→24 题，再升版
  // 2026-10-16 #1563（作者直派）：App 题答案项「暂不考虑」→「不会做，本站已永久停更」（与公告第 2 章停更口径对齐，消除「以后还会做」歧义），再升版
  const QUIZ_VER = '2026-10-16c';
  const IS_AUTOMATION = (typeof navigator !== 'undefined') &&
    (navigator.webdriver === true || /Headless/i.test(String(navigator.userAgent)));

  // ---------- 存储（根命名空间，同 applock.js 的 read/write 口径） ----------
  function gGet(k) {
    try { const v = window.xyStore ? window.xyStore(G).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
    try { return localStorage.getItem(G + ':' + k); } catch (e2) { return null; }
  }
  function gSet(k, v) {
    try { if (window.xyStore) window.xyStore(G).set(k, v); else localStorage.setItem(G + ':' + k, v); }
    catch (e) { try { localStorage.setItem(G + ':' + k, v); } catch (e2) {} }
  }
  // #1572：版本比较（放行判定不再用严格相等）——SW cache-first 下的「版本乒乓」：
  // 用户在较新版页面答对（存 v=较新），普通刷新命中旧缓存页（页内 QUIZ_VER 较旧）时，
  // 原来按严格相等＝弹问卷重答、且 markPassed 把记录降级回旧版；再硬刷新到新页又重问，
  // 循环往复＝「明明答对了还反复答题」。改为：本机记录的版本 ≥ 本页版本＝已放行；
  // 仅当本页问卷确实比记录新（真改版）才要求重答一次，「问卷更新后需重新作答」不变。
  // 版本形态 'YYYY-MM-DD' + 可选小尾巴（如 'c'）：日期段先比，尾巴按字典序比，异构串退回字典序。
  function quizVerCmp(a, b) {
    const sa = String(a == null ? '' : a), sb = String(b == null ? '' : b);
    if (sa === sb) return 0;
    const ma = sa.match(/^(\d{4}-\d{2}-\d{2})(.*)$/), mb = sb.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
    if (!ma || !mb) return sa > sb ? 1 : -1;
    if (ma[1] !== mb[1]) return ma[1] > mb[1] ? 1 : -1;
    const ta = ma[2] || '', tb = mb[2] || '';
    if (ta === tb) return 0;
    return ta > tb ? 1 : -1;
  }
  // 本机已通过本版问卷？（记录版本 ≥ 本页版本即放行，#1572）
  function passed() {
    if (IS_AUTOMATION) return true;
    try {
      const raw = gGet(K_PASS);
      if (!raw || String(raw).charAt(0) !== '{') return false;
      const o = JSON.parse(raw);
      if (!o || typeof o.v !== 'string' || !o.v) return false;
      return quizVerCmp(o.v, QUIZ_VER) >= 0;
    } catch (e) { return false; }
  }
  function markPassed() { gSet(K_PASS, JSON.stringify({ t: Date.now(), v: QUIZ_VER })); }

  // ---------- 题库（作者原文；k=single 单选 / multi 多选；a=正确项下标） ----------
  const QUESTIONS = [
    {
      // #1559（作者直派 2026-10-16）：「内容与功能使用」题，排在首位——前 6 项为正确项，末项为干扰项
      k: 'multi', q: '关于 mochi 字卡本站内容与功能使用，以下正确的是？', a: [0, 1, 2, 3, 4, 5],
      o: [
        '本站内容非常多，需要一定时间适应；网站本质只是工具，效果取决于个人使用和个人理解',
        '不适用本站的话，建议不使用，确实功能太多可能难度偏高',
        '聊天回复概率、写信、朋友圈，以及小功能等等很多功能是可以自己调概率或时间；聊天字卡可以单独关闭某个分组或某个单独的字卡',
        '默认词典字卡太多，不适用建议关闭；回复高频、通话高频都可以自行调整',
        '不懂的可以在功能说明里自行查看',
        '开屏里已经提示和强调过，需按个人使用自行设置；如果觉得不好用，应该先按个人使用习惯自行调整设置',
        '任何设置都没根据个人使用调整；要求作者会无条件按自己的想法全改'
      ]
    },
    { k: 'single', q: '本网站是什么？', o: ['字卡传讯', '小手机', 'AI聊天'], a: [0] },
    { k: 'single', q: '这个网站回复消息有 AI 吗？', o: ['有', '没有，纯代码运行'], a: [1] },
    { k: 'single', q: '本网站的内容是什么回复机制？', o: ['AI聊天', 'AI自动识别', '用系统内置字卡和你自己上传的字卡里挑选字卡，触发已设置的概率和时间，随机回复'], a: [2] },
    { k: 'single', q: '网站里会出现没有的内容吗？', o: ['有 AI 自动识别代回', '没有，只能出现代码里本身内置的内容和用户自己添加的内容'], a: [1] },
    {
      k: 'multi', q: '关于系统内置字卡锁定与二级密码（暗号），以下正确的是？', a: [0, 1, 2],
      o: ['锁定是面向未成年人的保护措施，不是 bug', '锁定时默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡会停用', '二级密码用来解锁系统内置字卡、跳过开屏的 2 个问答；不输密码也能正常使用全部功能', '锁定后网站完全无法使用，必须输密码才能用']
    },
    {
      k: 'multi', q: '关于本站的性质与收费，以下正确的是？', a: [0, 1, 2],
      o: ['本站是完全免费、作者个人出资和花费时间搭建的非盈利网站', '作者没有收过任何人一分钱，不靠卖链接、安装包、二级密码盈利', '任何以本站名义收费的情况均为诈骗，应拒绝付款并举报', '本站靠广告和会员费盈利']
    },
    { k: 'single', q: '当你在使用网站遇到问题时，公告中建议你首先怎么做？', o: ['直接去问作者，要求回复', '先看开屏公告、设置里的【常见问题】或【使用说明】，自己尝试解决'], a: [1] },
    {
      // #1562（作者直派 2026-10-16）：原「安卓设备问题处理」与「会不会做成 App」两题合并为一道多选（同一场景＝手机上用不顺怎么办），题库 25→24
      k: 'multi', q: '关于手机上遇到问题怎么处理、以及「会不会做成 App」，公告的说法是？', a: [0, 1, 2],
      o: [
        '安卓手机不要用自带的浏览器（如小米、华为自带），改用 Chrome 或 Edge；若仍有问题，可自行下载开源代码，根据个人设备自行调整',
        '「会不会做成 App」：不会做，本站已永久停更；可以用桌面快捷方式',
        '不做 App 的原因：网站功能非常多，做成 App 可能出现的 Bug 只会更多，且不同手机适配难，没有这种精力和金钱',
        '手机坏了，换新手机',
        'App 已经在开发中，马上就会出',
        '有第三方套壳 App，建议使用'
      ]
    },
    {
      k: 'multi', q: '关于本站的数据存储与防丢失，以下说法正确的是', a: [0, 1, 2],
      o: ['本站没有云端、没有服务器、没有账号体系，数据从一开始就只保存在你自己设备的浏览器本地', '一旦数据丢失，作者也无法找回，只能靠自己提前导出备份', '定期导出数据备份，并且 iPhone 用户请用 Safari 浏览器「添加到主屏幕」后再使用', '只要给钱就能找回，或清理手机缓存、一键优化也没关系']
    },
    {
      k: 'single', q: '本站已开源、已永久停更，遇到设备兼容问题时的基础规则是什么？', a: [1],
      o: ['只要有问题，作者就必须继续帮所有人修', '作者不再帮调不同设备的兼容问题；基础做法是自己换兼容问题少的浏览器，或自行下载开源代码，根据自己的设备自行修改', '停更只是说说，作者仍然会私下帮所有人修', '开源只是形式，实际不能自己改']
    },
    { k: 'single', q: '点击进入本网站，即视为您确认已年满多少周岁？', o: ['16周岁', '18周岁', '20周岁', '未满18周岁但家长同意'], a: [1] },
    {
      k: 'multi', q: '关于免责声明中「自行导入的内容」，以下正确的是', a: [0, 2, 3],
      o: ['用户自行导入的音乐、图片、表情等，其版权和合法性由用户本人负责', '可以随意导入和分享侵权、违法的内容', '作者不承担由此产生的任何纠纷与责任', '禁止利用本站从事违法、骚扰、诈骗等活动']
    },
    {
      k: 'single', q: 'Mochi 字卡网站是完全免费的。如果有人向你收费售卖链接、安装包或二级密码，你应该怎么做？', a: [1],
      o: ['乖乖付钱', '对方是骗子，拒绝付款并举报卖家', '正常交易，觉得不关自己的事', '不知道网站是免费的']
    },
    {
      k: 'single', q: '搬运、二传本站链接到公开平台（如小红书、抖音等）时，必须怎么做？', a: [1],
      o: ['不需要标注任何署名', '必须标注作者署名', '只要不收费就可以不标署名', '只要不是二改就可以不标署名']
    },
    {
      k: 'multi', q: '关于发帖和正确引流的规范，以下正确的是', a: [0, 1],
      o: ['禁止带 #小手机 等与字卡传讯无关 tag 发帖引流', '保持基本的礼貌与规则，不要扩圈、刷屏引流', '要求发帖必须写强制关注或「评论夸夸才能给链接」']
    },
    {
      k: 'multi', q: '以下哪些行为属于本网站明令禁止的严重违规行为？', a: [0, 1, 2, 3, 4, 5],
      o: ['以盈利为目的倒卖网站链接、安装包', '搬运、二传本站链接到公开平台（如小红书、抖音等）时，删除或修改作者署名（言序）', '搬运、二传本站链接到公开平台时，不标作者署名，并强行设置关注、夸夸等门槛才给链接（本站一直无门槛、完全免费，链接就在作者的小红书和抖音主页，没有任何强制点赞关注收藏才能拿的门槛）', '冒名顶替，宣称网站是自己制作的', '将二级验证密码（暗号）和问卷答案公开转发给他人', '二改后公开内置字卡，或公开云存储功能']
    },
    {
      k: 'multi', q: '关于本站对二改、借鉴、复刻的规则，以下正确的是', a: [0, 1, 2, 3],
      o: ['支持正常使用代码进行二改、借鉴和单独复刻某个功能，但必须标注来源', '二改和借鉴目前随意开放，标注来源即可使用', '照搬大量功能和机制、连内置文字都原样复制、拼成新网站、不标注来源等，属于违规行为', '一旦出现违规行为，将停止公开代码，收回供人参考的代码和后续二改权限']
    },
    {
      k: 'single', q: 'mochi 字卡的停更时间线与制作周期，以下正确的是？', a: [0],
      o: ['2026.08.12 开始制作 → 2026.08.15 开始内测 → 2026.08.29 正式公开 → 2026.09.30 完结停更，一共制作 50 天', '2026.08.12 正式公开 → 2026.08.29 完结停更，一共 30 天', '2026.09.30 开始制作 → 2026.10.30 完结停更，一共 90 天', '没有明确时间线，随时可能停更']
    },
    {
      k: 'single', q: '关于停更后的 GitHub 开源代码，以下说法正确的是？', a: [1],
      o: ['停更后代码不再开源，无法下载', '代码已在 GitHub 完全开源，停更后仍可继续下载、自行修改', '只有作者本人能下载代码', '代码只对二改作者开放']
    },
    {
      k: 'multi', q: '本站永久停更后，关于使用问题与设备兼容问题的处理规则是？', a: [0, 1],
      o: ['停更后不再更新功能，网站的基础使用问题也不再逐一解答', '不再帮人调不同设备型号的兼容 bug，建议自己拿代码给 AI 调', '停更只是不更新内容，使用问题和设备 bug 还是可以继续找作者']
    },
    {
      k: 'single', q: '作者停更前，有没有帮过设备兼容问题？', a: [1],
      o: ['从来没帮过', '帮过，之前开过群、也私信帮人修过不同设备的兼容问题；但停更后不再处理这些了', '只帮 iOS 用户修过', '只帮安卓用户修过']
    },
    {
      k: 'single', q: '停更后，如果你遇到使用问题，正确的做法是？', a: [1],
      o: ['去找作者，作者必须回', '本站功能本身就多，需要自己调整和适应；自行探索使用，先看开屏公告和设置里的【常见问题】【使用说明】，设备问题换兼容好的浏览器，或自己下载开源代码自己调']
    },
    {
      // #1551：公告第 8 章「电子网站会连上鬼」传闻（作者 2026-10-15 改写）——作为准入门槛题放在末位
      // 2026-10-15 #1553（作者直派）：删掉原第 5 条干扰项（那一条把传闻当事实、并说遇到的人不能退出）
      k: 'multi', q: '关于「电子网站会连上鬼」的传闻，以下正确的是？', a: [0, 1, 2, 3],
      o: [
        '本站没有灵异机制：本质只是代码随机概率运行触发回复，呈现的内容仅为系统内置字卡或你自己添加的字卡，代码已在 GitHub 完全公开',
        '字卡只是工具，体验因人而异：人在高度专注、心理暗示或情绪紧张时，很容易产生主观上的「错觉」或「巧合感」',
        '如果遇到无法解释的情况或感到恐惧：立刻停止使用、不要过度联想、寻求现实帮助',
        '不同人的说法可能不一样，有些是恶作剧、有些无法证实真假，请以自身感受为准，感到不适随时退出'
      ]
    }
  ];

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(msg) {
    try { if (window.toast) { window.toast(msg); return; } } catch (e) {}
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2200);
  }
  function sameSet(sel, ans) {
    if (sel.length !== ans.length) return false;
    for (let i = 0; i < ans.length; i++) if (sel.indexOf(ans[i]) < 0) return false;
    return true;
  }

  let pendingNext = null;
  let pageEl = null;

  function cleanup() {
    const sp = document.getElementById('splash');
    if (sp) sp.classList.remove('eqz-active');
    if (pageEl && pageEl.parentNode) pageEl.parentNode.removeChild(pageEl);
    pageEl = null;
  }

  // 跳转到问卷页：作为 .splash 内的整页子节点（与开屏同层），收起原开屏内容
  function open(next) {
    pendingNext = next || null;
    const sp = document.getElementById('splash');
    if (!sp) { // 没有开屏（已在应用内）→ 直接放行
      const cb = pendingNext; pendingNext = null; if (cb) cb();
      return;
    }
    if (pageEl && pageEl.parentNode) { sp.classList.add('eqz-active'); return; } // 已打开则不重绘

    const total = QUESTIONS.length;
    // #1576：选项本体不再用任何表单控件（label+input 全部退役）——用户机型内核连视觉隐藏的
    // input 都会当文本框渲染（选项前冒 value 数字＋点击聚焦弹输入法），CSS 隐藏治不了它；
    // 选中状态全由 picks 管（radio 单选覆盖 / multi 点选切换），判分/进度/重答全走 picks，
    // 页面里没有 input 可渲染、没有文本框可聚焦，数字与键盘问题从根上消失
    const picks = QUESTIONS.map(function () { return []; });
    let rows = '';
    QUESTIONS.forEach(function (it, i) {
      let opts = '';
      it.o.forEach(function (txt, j) {
        // #1571：label 带类型 class（eqz-radio/eqz-check）——选中指示器为 CSS 自绘（见 entry-quiz.css），
        // #1576 起元素从 label 换成 button（type="button" 防任何表单语义），data-i/data-j 供点选委托
        opts += '<button type="button" class="eqz-opt ' + (it.k === 'multi' ? 'eqz-check' : 'eqz-radio') + '" data-i="' + i + '" data-j="' + j + '">' +
          '<span class="eqz-opt-t">' + esc(txt) + '</span></button>';
      });
      rows += '<div class="eqz-q" data-i="' + i + '">' +
        '<div class="eqz-qh"><span class="eqz-idx">' + (i + 1) + '.</span>' +
        '<span class="eqz-tag">' + (it.k === 'multi' ? '多选' : '单选') + '</span>' + esc(it.q) + '</div>' +
        opts + '</div>';
    });

    const el = document.createElement('div');
    el.className = 'eqz-page';
    el.id = 'entry-quiz-page';
    el.innerHTML =
      // #1566（作者反馈）：页头说明改为随内容滚动——固定页头补了第二段说明后占掉大半屏，挡住题目；
      // 「已答 X/24」进度移到底部提交区保持常显
      '<div class="eqz-view" id="eqz-view-quiz">' +
      '<div class="eqz-scroll" id="eqz-scroll">' +
      '<div class="eqz-head">' +
      // #1556（作者直派）：左上角随时可返回开屏（放弃本次作答，重进即全新问卷）
      '<button type="button" class="eqz-back" id="eqz-back">‹ 返回开屏</button>' +
      '<div class="eqz-title">入站问卷 · 答对全部题目才能进入</div>' +
      '<div class="eqz-sub">2026.10.16：本来已永久停更，不该再更改任何内容，但mochi 的密码早已被大范围泄露（有人私传、二传链接时把密码一起传、确认成年就直接传密码），违规使用、不遵守使用规则的情况越来越多。密码暂不修改，但新增入站问卷：答对全部题目才能恢复使用。题目都是公告与使用规则里的内容，答对一次本机永久放行（问卷更新后需重新作答）。</div>' +
      '<div class="eqz-sub">问卷是在开屏内容里提取的，如果有人选项实在是不会，可以稍微提示，但禁止泄露问卷答案。如果问卷答案也被泄露将换更难的题目。一直都说过，密码只是用来锁系统内置字卡的，对其他使用不影响。并不是针对想正常使用的人，只是网站人流量越来越多，满打满算这个网站也才诞生两个月而已，现在不加以管控，未来可能出现的情况更难以控制，已把入站问卷列入使用前必答条件。</div>' +
      // #1568（作者直派 2026-10-16）：文案最末补「仍旧找不到密码」的提示——密码就是下面某题正确选项里的那串字面日期，不是解密题
      '<div class="eqz-sub">依旧找不到密码的可以在问卷的某个题目的选项答案里找到密码，只要认真看就能找到，开屏也写了详细的提示，字卡生日是字面意思，根本不是解密之类的难密码</div>' +
      '</div>' +
      rows +
      '</div>' +
      '<div class="eqz-foot">' +
      '<div class="eqz-progress" id="eqz-progress">已答 0 / ' + total + '</div>' +
      '<div class="eqz-note">答题过程中不显示对错；点「提交答案」后跳到结果页，才知道哪些题没答对（多选题会提示共有几个正确答案）。</div>' +
      '<button type="button" class="eqz-btn" id="eqz-submit">提交答案</button>' +
      '</div></div>' +
      '<div class="eqz-view" id="eqz-view-result" hidden></div>';

    sp.appendChild(el);
    sp.classList.add('eqz-active');
    pageEl = el;

    const progressEl = el.querySelector('#eqz-progress');
    function refreshProgress() {
      let n = 0;
      picks.forEach(function (p) { if (p.length) n++; });
      if (progressEl) progressEl.textContent = '已答 ' + n + ' / ' + total;
    }
    // #1576：点选委托（原生 input 的 change 监听随表单控件一起退役）
    el.addEventListener('click', function (e) {
      const o = e.target && e.target.closest ? e.target.closest('.eqz-opt') : null;
      if (!o || !el.contains(o)) return;
      const i = parseInt(o.getAttribute('data-i'), 10);
      const j = parseInt(o.getAttribute('data-j'), 10);
      const it = QUESTIONS[i];
      if (!it || isNaN(i) || isNaN(j)) return;
      if (it.k === 'multi') {
        const at = picks[i].indexOf(j);
        if (at >= 0) picks[i].splice(at, 1); else picks[i].push(j);
        o.classList.toggle('is-sel', at < 0);
      } else {
        if (picks[i][0] === j) return; // 重点已选的单选项＝维持原选，不抖动
        picks[i] = [j];
        Array.prototype.forEach.call(o.parentNode.querySelectorAll('.eqz-opt'), function (s) {
          s.classList.toggle('is-sel', s === o);
        });
      }
      refreshProgress();
    });

    const scrollEl = el.querySelector('#eqz-scroll');
    // #1556（作者直派）：答题页与结果页两视图切换（结果页在提交后出现，答题页本页不显示对错、防反复试错）
    function switchView(showResult) {
      const vq = el.querySelector('#eqz-view-quiz');
      const vr = el.querySelector('#eqz-view-result');
      if (vq) vq.hidden = showResult;
      if (vr) vr.hidden = !showResult;
      el.classList.toggle('is-result', !!showResult);
      if (scrollEl) scrollEl.scrollTop = 0;
    }
    // 「返回开屏」＝放弃本次作答、关掉问卷页恢复开屏内容；重进即全新问卷
    function backToSplash() { pendingNext = null; cleanup(); }
    // 「再答一次」＝清空全部已选、从头重答（不是留在原页改错题，防试错）
    function retryQuiz() {
      picks.forEach(function (p, i) { picks[i] = []; });
      Array.prototype.forEach.call(el.querySelectorAll('.eqz-opt.is-sel'), function (o) { o.classList.remove('is-sel'); });
      refreshProgress();
      switchView(false);
    }
    function submit() {
      const bads = [];
      QUESTIONS.forEach(function (it, i) {
        const sel = picks[i].slice().sort(function (x, y) { return x - y; });
        if (!sameSet(sel, it.a)) bads.push({ n: i + 1, multi: it.k === 'multi', cnt: it.a.length });
      });
      const vr = el.querySelector('#eqz-view-result');
      if (!vr) return;
      if (bads.length) {
        let list = '';
        bads.forEach(function (b) {
          // #1553（作者直派）：答错时写明错在哪；多选题给出「本题共 N 个正确答案」——提示统一放结果页（#1556）
          list += '<div class="eqz-rs-li"><span class="eqz-rs-n">第 ' + b.n + ' 题</span>' +
            (b.multi ? '多选 · 本题共 ' + b.cnt + ' 个正确答案' : '单选 · 本题只有 1 个正确答案') + '</div>';
        });
        vr.innerHTML =
          '<div class="eqz-rs eqz-rs-bad">' +
          '<div class="eqz-rs-t">还有 ' + bads.length + ' 题没答对</div>' +
          '<div class="eqz-rs-d">答题过程中不显示对错，结果在这里统一告知。以下是没有答对的题目（多选题已写明共有几个正确答案）：</div>' +
          '<div class="eqz-rs-list">' + list + '</div>' +
          '<div class="eqz-rs-d">点「再答一次」会清空全部已选、从头重答；也可以先返回开屏，之后从开屏重新进入。</div>' +
          '<button type="button" class="eqz-btn" id="eqz-retry">再答一次</button>' +
          '<button type="button" class="eqz-btn eqz-btn-ghost" id="eqz-exit">返回开屏</button>' +
          '</div>';
        const retry = vr.querySelector('#eqz-retry');
        if (retry) retry.addEventListener('click', retryQuiz);
        const exit = vr.querySelector('#eqz-exit');
        if (exit) exit.addEventListener('click', backToSplash);
        switchView(true);
        return;
      }
      // 全对 → 通过结果页：先展示「只需答一次」说明，点「进入」才放行（#1556 作者要求明确告知）
      vr.innerHTML =
        '<div class="eqz-rs eqz-rs-ok">' +
        '<div class="eqz-rs-t">✓ 答题通过</div>' +
        '<div class="eqz-rs-d">此答题只需答一次：点「进入」后本机会记住已通过，以后打开不再出现；仅当问卷内容更新后才会重新出现一次。</div>' +
        '<button type="button" class="eqz-btn" id="eqz-go">进入</button>' +
        '</div>';
      const go = vr.querySelector('#eqz-go');
      if (go) go.addEventListener('click', function () {
        markPassed();
        toast('入站问卷已通过，欢迎使用');
        const cb = pendingNext; pendingNext = null;
        cleanup();
        if (cb) cb();
      });
      switchView(true);
    }
    const btn = el.querySelector('#eqz-submit');
    if (btn) btn.addEventListener('click', submit);
    const back = el.querySelector('#eqz-back');
    if (back) back.addEventListener('click', backToSplash);
    refreshProgress();
  }

  // ---------- 对外接口（clock.js 调用） ----------
  window.mochiEntryQuizPassed = passed;
  window.mochiEntryQuizGate = function (next) {
    if (passed()) { if (next) next(); return; }
    open(next);
  };

  window.__entryQuizReady = true;
  // 无头/验证入口（tools/verify-*.mjs 用）
  window.__entryQuizTest = {
    ver: QUIZ_VER,
    list: function () { return QUESTIONS.map(function (it) { return { k: it.k, q: it.q, n: it.o.length, a: it.a.slice() }; }); },
    reset: function () { try { localStorage.removeItem(G + ':' + K_PASS); } catch (e) {} },
    pass: function () { markPassed(); }
  };
})();
