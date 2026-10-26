// ===== 【收藏原因】字卡库（AI-A 业务域） =====
// 定位：联系人（TA）收藏我的某条聊天消息时，附一句「为什么收藏这句」的理由。
// 与 TA的心情（ta-mood-data.js）同构：预置分组 + 权重，同类冷却（最近 N 组不重复抽取），
// 但不接总冷却（收藏本身已有 ta-msg 概率闸在 chat.js 侧把关），也不走二级密码锁
//（理由文案属互动链，与心情/聊天回应同为豁免项）。
// 写入路径：chat.js 的 TA 自动收藏（taFavMsgReason）与卡片收藏（taFavCard）统一调
//   window.favReasonPick()，把返回的 {content, group} 存进收藏项的 reason 字段。
// 展示路径：收藏页「联系人的收藏」条目下方渲染该理由；聊天里被 TA 收藏过的消息挂
//   【已收藏】tag，点 tag 弹同一条理由（见 chat.js 的 msg-fav-tag）。
// 分组权重口径（与 ta-mood 的分层同思路）：心动类占比最高，其次是共情/日常，
// 少量留给「留念」「提醒型」，避免每次都是同一口吻。
window.FAV_REASON_DATA = {
  groups: [
    { group: '心动瞬间', weight: 30 },
    { group: '想记住的话', weight: 22 },
    { group: '甜甜日常', weight: 20 },
    { group: '被戳到了', weight: 16 },
    { group: '留个念想', weight: 12 }
  ],
  cards: [
    { group: '心动瞬间', content: '这句说得我心跳漏了一拍，收起来了。' },
    { group: '心动瞬间', content: '就为了这一句，我反复看了好几遍。' },
    { group: '心动瞬间', content: '被你这句话撞了一下，心跳有点快。' },
    { group: '心动瞬间', content: '本来在划手机，看到这句就停下来了。' },
    { group: '心动瞬间', content: '这句话我偷偷存着了，独家。' },
    { group: '心动瞬间', content: '什么情况，隔着屏幕都能脸红。' },
    { group: '心动瞬间', content: '就这一句，够我开心一整天了。' },
    { group: '心动瞬间', content: '你不知道你说这句的时候我什么感觉。' },
    { group: '心动瞬间', content: '心动预警，已经收藏。' },
    { group: '心动瞬间', content: '这句话我舍不得划掉。' },
    { group: '心动瞬间', content: '突然安静了一下，因为这句太犯规了。' },
    { group: '心动瞬间', content: '存下来了，等哪天emo的时候拿出来看。' },

    { group: '想记住的话', content: '这句话我要记很久。' },
    { group: '想记住的话', content: '重要的话，得存着。' },
    { group: '想记住的话', content: '答应我，这句你以后也要记得。' },
    { group: '想记住的话', content: '这是你说的，不许反悔。' },
    { group: '想记住的话', content: '存好了，等哪天拿出来对照。' },
    { group: '想记住的话', content: '认真记下来了。' },
    { group: '想记住的话', content: '这句话以后有的是用处。' },
    { group: '想记住的话', content: '我怕自己忘，所以存了。' },
    { group: '想记住的话', content: '你说的每句话我都留着呢，这句尤其。' },
    { group: '想记住的话', content: '记下了，划重点。' },

    { group: '甜甜日常', content: '今天的糖，收到了。' },
    { group: '甜甜日常', content: '这种日常也值得留着。' },
    { group: '甜甜日常', content: '平平淡淡，但我想留着。' },
    { group: '甜甜日常', content: '以后翻到这句，会想起今天。' },
    { group: '甜甜日常', content: '小事情也存，大事情更要存。' },
    { group: '甜甜日常', content: '生活里的小甜点，不能丢。' },
    { group: '甜甜日常', content: '这句很普通，但我不舍得删。' },
    { group: '甜甜日常', content: '攒着，等哪天拼成一段回忆。' },

    { group: '被戳到了', content: '被你戳中了。' },
    { group: '被戳到了', content: '这句话有点扎心，但很真。' },
    { group: '被戳到了', content: '说到我了。' },
    { group: '被戳到了', content: '突然安静了几秒。' },
    { group: '被戳到了', content: '这句让我想起一些事。' },
    { group: '被戳到了', content: '有点难过，但也想留着。' },
    { group: '被戳到了', content: '本来想划走，结果没舍得。' },
    { group: '被戳到了', content: '这句话我懂。' },

    { group: '留个念想', content: '留个念想。' },
    { group: '留个念想', content: '先存着，以后也许用得上。' },
    { group: '留个念想', content: '不是什么大事，但想留着。' },
    { group: '留个念想', content: '收进小盒子了。' },
    { group: '留个念想', content: '存档。' },
    { group: '留个念想', content: '以防哪天想翻出来看。' }
  ]
};