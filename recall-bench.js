'use strict';
// 跨渠道跟进 · 召回评测（P0 第二步，不改 Hub 代码，单文件，只依赖 Node 22）。
// 测什么：从上千条真实消息里，能不能把和「转发邮件」相关的那几条找出来。
// 怎么测：读 Hub 存在本机的消息快照（助理目录里的 raw-日期.json，Hub 每 10 分钟自己更新，本脚本不调 welink-cli），
//         把 cases.json 里 7 个编好的用例混进去，再用召回规则去找，看找全了没有、混进了多少真实消息。
// 两种难度：A 用例群保持原名（群名能帮忙）；B 用例群消息并入你最活跃的真实群（只能靠内容、发言人、时间）。
// 隐私：真实消息只在本机读。report.md / summary.json 只有数字和用例（编造）消息，不含任何真实消息原文、群名、人名，可以发出来。
//       加 --local-detail 时另写一份 local-only-detail.md 列出混进来的真实消息，只给你自己调规则时看，不要外发。
//
// 用法：node recall-bench.js
//       node recall-bench.js --dir "C:\Users\xxx\.ai-hub-community\company-assistant" --days 7 --local-detail
const fs = require('fs'), path = require('path'), os = require('os');

const argv = process.argv.slice(2), opt = (k, d) => {
  const eq = argv.find(a => a.startsWith('--' + k + '=')); if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
}, flag = k => argv.includes('--' + k);
const HOME = process.env.USERPROFILE || os.homedir();
const DIR = opt('dir', process.env.CLAUDE_HUB_ASSISTANT_DIR || path.join(HOME, '.ai-hub-community', 'company-assistant'));
const DAYS = Math.max(1, Number(opt('days', 14)));
const FILE = opt('file', path.join(__dirname, 'cases.json'));
const STAMP = new Date(Date.now() + 8 * 3600000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(opt('out', path.join(__dirname, 'recall-' + STAMP)));
const KS = String(opt('k', '3,5,10,20')).split(',').map(Number).filter(n => n > 0);
const GAP = Number(opt('gap-minutes', 60)) * 60000; // 同一会话里，间隔超过这么久就切成新的一段
// 上下文：回复和补充多在锚点之后，所以前面少带、后面多带。
const CTX_BEFORE = Number(opt('ctx-before', 2)), CTX_AFTER = Number(opt('ctx-after', 6)), CTX_BEFORE_MIN = Number(opt('ctx-before-minutes', 15)) * 60000, CTX_AFTER_MIN = Number(opt('ctx-after-minutes', 60)) * 60000, PERSON_ONLY = Number(opt('person-only', 0.8)), AT_ME = Number(opt('at-me', 3));
const EXPAND = opt('expand', 'on') !== 'off', EXPAND_K = Number(opt('expand-k', 20)), EXPAND_CAP = Number(opt('expand-cap', 60)), EXPAND_NEXT = Number(opt('expand-next', 1)),
  REPLY_MIN = Number(opt('reply-minutes', 120)) * 60000, REPLY_N = Number(opt('reply-n', 2));
const FOLLOW = Number(opt('follow', 4)), FOLLOW_N = Number(opt('follow-n', 3)), FOLLOW_DAYS = Number(opt('follow-days', 7)) * 86400000;
const MODES = String(opt('modes', 'segment,anchor')).split(',');
const NAME_CAP = Number(opt('name-cap', 6)), MIN_HIT = Number(opt('min-hit', 2)), FLOOR = Number(opt('floor', 0.4));
const LOOKBACK = Number(opt('lookback-days', 3)) * 86400000; // 种子邮件发出前多少天的消息也算候选
const log = (...a) => console.error('[recall]', ...a);
const WEEK = 7 * 86400000;

// 关键消息：直接改变卡片内容的（漏了会让卡片出错）。其余（收到、提问、会议）漏了影响小。
const KEY_TYPES = new Set(['task_assignment', 'deadline_change', 'extension_request', 'extension_approved', 'requirement', 'delivery', 'nil_delivery',
  'delivery_by_others', 'cancel', 'info_confirmed']);

// 从正文里解析「@名字」（快照里没有单独的被 @ 名单；用例消息也照样带 mentions）。
const mentionsOf = t => [...String(t || '').matchAll(/(?:^|[\s，,。])@([^\s@，,：:。]{1,12})/g)].map(x => x[1]);

// ---------- 读真实快照 ----------
function loadSnapshots() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => /^raw-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().slice(-DAYS); } catch {}
  const messages = new Map(), convs = new Map(); let at = 0;
  for (const f of files) {
    let s; try { s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
    at = Math.max(at, Number(s.at) || 0);
    for (const c of s.conversations || []) if (c && c.id) convs.set(String(c.id), { id: String(c.id), group: !!c.group, name: String(c.name || c.id) });
    for (const [cid, list] of Object.entries(s.messages || {})) for (const m of list || []) {
      if (!m || !Number.isFinite(m.at)) continue;
      const key = m.sourceId || `msg:${cid}:${m.key}`;
      messages.set(key, { id: key, real: true, conv: String(m.conv || cid), convName: m.convName, group: !!m.group, at: m.at,
        sender: m.mine ? '我' : String(m.sender || ''), mine: !!m.mine, atMe: !!m.atMe, text: String(m.text || m.preview || ''),
        mentions: mentionsOf(m.text || m.preview) });
      if (!convs.has(String(cid))) convs.set(String(cid), { id: String(cid), group: !!m.group, name: String(m.convName || cid) });
    }
    for (const m of s.mails || []) if (m && m.sourceId && Number.isFinite(m.at)) messages.set(m.sourceId, { id: m.sourceId, real: true, mail: true, at: m.at,
      subject: String(m.subject || ''), sender: String(m.from || ''), text: `${m.subject || ''} ${m.preview || ''}` });
  }
  return { files, messages: [...messages.values()], convs: [...convs.values()], at };
}

// ---------- 分词与权重 ----------
// 中文按两个字一组，英文数字按词。权重用 IDF：在全部消息里越少见的词越有区分度（「请」「提交」这类自动变轻）。
const tokens = s => {
  const t = String(s || '').toLowerCase(), out = new Set();
  for (const w of t.match(/[a-z][a-z0-9_]+|\d*[a-z]+\d+[a-z0-9]*/g) || []) out.add(w);
  for (const run of t.match(/[\u3400-\u9fff]+/g) || []) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  return out;
};
function idfOf(docs) {
  const df = new Map();
  for (const d of docs) for (const w of tokens(d)) df.set(w, (df.get(w) || 0) + 1);
  // 每个词先扣掉一个基础分（FLOOR × log N）：常见词（部门、两个、提交）几乎不得分，
  // 避免一段话里几个常见词凑在一起，分数反而超过只命中一个专有词（体检、校准）的段。
  const N = docs.length, floor = FLOOR * Math.log(N + 1);
  return w => Math.max(0, Math.log((N + 1) / ((df.get(w) || 0) + 1)) - floor);
}

// ---------- 把用例混进真实数据 ----------
const DATA = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const PEOPLE = DATA.people || [];
const ME = PEOPLE.find(p => p.id.startsWith('u_'));
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const byEmail = new Map(PEOPLE.map(p => [p.email.toLowerCase(), p]));
const listMembers = new Map((DATA.distribution_lists || []).map(l => [l.address.toLowerCase(), Array.isArray(l.members) ? l.members : []]));

// 种子邮件的参与人（WeLink 名）：发件人、收件人、抄送，邮件组展开。
function participants(email) {
  const names = new Set();
  for (const raw of [email.from, ...email.to, ...(email.cc || [])]) {
    const addr = (String(raw).match(/<([^>]+)>/) || [, raw])[1].trim().toLowerCase();
    const p = byEmail.get(addr); if (p) names.add(p.welink_name);
    for (const id of listMembers.get(addr) || []) { const q = PEOPLE.find(x => x.id === id); if (q) names.add(q.welink_name); }
  }
  names.delete(ME.welink_name);
  return names;
}

// 用例消息 → 和快照同样的形状。shift：整周平移，让用例的「现在」落在快照最新时间附近（星期几不变）。
function injected(c, shift, variant, realGroups) {
  const out = [], label = new Map(c.expected.message_labels.map(l => [l.msg_id, l]));
  const rel = id => arr(label.get(id)?.matter).length > 0, type = id => label.get(id)?.type || 'irrelevant';
  c.groups.forEach((g, i) => {
    // B：并入第 i 活跃的真实群（找不到真实群就保持原样）。
    const host = variant === 'B' && realGroups[i] ? realGroups[i] : { id: `case:${g.group_id}`, name: g.name };
    for (const m of g.messages) out.push({ id: m.msg_id, real: false, case: c.case_id, relevant: rel(m.msg_id), type: type(m.msg_id),
      conv: host.id, convName: host.name, group: true, at: Date.parse(m.sent_at) + shift, sender: m.sender === ME.welink_name ? '我' : m.sender,
      mine: m.sender === ME.welink_name, atMe: (m.mentions || []).includes(ME.welink_name),
      mentions: m.mentions || [], text: `${m.text} ${(m.attachments || []).join(' ')}` });
  });
  for (const d of c.dms || []) for (const m of d.messages) out.push({ id: m.msg_id, real: false, case: c.case_id, relevant: rel(m.msg_id), type: type(m.msg_id),
    conv: `case:${d.dm_id}`, convName: d.peer, group: false, at: Date.parse(m.sent_at) + shift, sender: m.sender === ME.welink_name ? '我' : m.sender,
    mine: m.sender === ME.welink_name, atMe: false, mentions: [], text: `${m.text} ${(m.attachments || []).join(' ')}` });
  for (const e of c.emails) if (!arr(c.seed_email_id).includes(e.msg_id)) out.push({ id: e.msg_id, real: false, case: c.case_id, relevant: rel(e.msg_id), type: type(e.msg_id),
    mail: true, inReplyTo: e.in_reply_to || '', subject: e.subject, at: Date.parse(e.sent_at) + shift, sender: e.from, text: `${e.subject} ${e.body} ${(e.attachments || []).join(' ')}` });
  return out;
}

// ---------- 召回规则 ----------
// 1. 邮件：回复同一封、或去掉 RE/FW 后主题相同 → 直接收。
// 2. 聊天：按会话切段（间隔超过 GAP 切开），给每段打分，按分数取前 K 段，段里的消息全部收进来交给模型判断。
//    段分 = 段内最高的「内容分」+ 会话名分 + 发言人分。
//    内容分：消息和种子邮件（主题、正文、附件名）共有的词，按 IDF 加权求和。
//    会话名分：群名 / 私聊对象名和种子邮件共有的词；私聊对象是邮件参与人再加分。段内容没命中时只给三成。
//    发言人分：段里有邮件参与人发言或被 @，且这段本身有内容命中时加分（避免参与人闲聊被拉进来）。
const normSubject = s => String(s || '').replace(/^\s*((re|fw|fwd|回复|转发)\s*[:：]\s*)+/i, '').trim();
function recall(seed, pool, idf, until, mode = 'segment') {
  const from = Date.parse(seed.sent_at) - LOOKBACK;
  const inWin = pool.filter(m => m.at >= from && m.at <= until);
  const seedText = `${seed.subject} ${seed.subject} ${seed.body} ${(seed.attachments || []).join(' ')}`;
  const seedTok = tokens(seedText), people = participants(seed);
  const overlap = s => { let v = 0; for (const w of tokens(s)) if (seedTok.has(w)) v += idf(w); return v; };

  const picked = new Set();
  for (const m of inWin) if (m.mail && (m.inReplyTo === seed.msg_id || (m.subject && normSubject(m.subject) === normSubject(seed.subject)))) picked.add(m.id);
  // 宁多勿漏 · 邮件按人收（2026-11-10）：邮件参与人在种子邮件发出之后发来的邮件全部收进来，不再只认回复同一封或同主题。
  const seedAt = Date.parse(seed.sent_at);
  if (EXPAND) for (const m of inWin) if (m.mail && m.at >= seedAt && people.has(mailSenderName(m.sender))) picked.add(m.id);

  const byConv = new Map();
  for (const m of inWin.filter(m => !m.mail)) { if (!byConv.has(m.conv)) byConv.set(m.conv, []); byConv.get(m.conv).push(m); }
  if (mode === 'anchor') {
    const ranked = anchors(byConv, overlap, people);
    return { mails: picked, ranked, expand: EXPAND ? expandByPeople(ranked, byConv, people, seedAt) : new Set(), windowSize: inWin.filter(m => m.real).length };
  }
  const segs = [];
  for (const list of byConv.values()) {
    list.sort((a, b) => a.at - b.at);
    let cur = [];
    const close = () => { if (cur.length) segs.push(cur); cur = []; };
    for (const m of list) { if (cur.length && m.at - cur[cur.length - 1].at > GAP) close(); cur.push(m); }
    close();
  }
  const scored = segs.map(seg => {
    const first = seg[0];
    const content = Math.max(...seg.map(m => overlap(m.text)));
    // 群名里的词在消息正文里很少见，IDF 会偏高，所以群名分封顶 NAME_CAP。
    let name = Math.min(NAME_CAP, overlap(first.convName || ''));
    if (!first.group && people.has(first.convName)) name += 3;
    const talk = seg.some(m => people.has(m.sender) || (m.mentions || []).some(x => people.has(x)));
    const hit = content >= MIN_HIT; // 只有「部门」「提交」这类常见词重合不算命中
    const person = talk && hit ? 2 : 0;
    return { seg, content, name, person, hit };
  });
  // 群名加分：这段内容命中，或同一会话里别的段命中过（说明这个群确实在聊这件事）时全额给；否则只给三成，
  // 避免一个名字相近、但没在聊这件事的群把它每段闲聊都顶到前面。
  const hitConvs = new Set(scored.filter(x => x.hit).map(x => x.seg[0].conv));
  for (const x of scored) x.score = x.content + (x.hit || hitConvs.has(x.seg[0].conv) ? x.name : x.name * 0.3) + x.person;
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.filter(x => x.score > 0);
  return { mails: picked, ranked, windowSize: inWin.filter(m => m.real).length };
}

// 锚点找法（2026-11-09 真实数据后新增）：活跃大群里消息很密，按间隔切出的段很长，一段能带进几十条无关消息，
// 而且长段里总有几个词碰巧重合，分数虚高。改成按单条消息打分，取分数最高的 K 条做锚点，
// 每个锚点带上同一会话里前 CTX_BEFORE 条、后 CTX_AFTER 条（各有时间上限）作为上下文（「收到」「同上」、提问后的回答靠这个带进来）。
function anchors(byConv, overlap, people) {
  const all = [];
  for (const list of byConv.values()) {
    list.sort((a, b) => a.at - b.at);
    const name0 = Math.min(NAME_CAP, overlap(list[0].convName || '')) + (!list[0].group && people.has(list[0].convName) ? 3 : 0);
    list.forEach((m, i) => {
      const content = overlap(m.text), hit = content >= MIN_HIT;
      const talk = people.has(m.sender) || (m.mentions || []).some(x => people.has(x));
      // 邮件参与人在群里 @我：很可能就是在说这件事（「@你 那边外包也单独列一下」这种和邮件没有共同词的补充要求）。
      const atMeBy = m.atMe && people.has(m.sender) ? AT_ME : 0;
      all.push({ m, i, list, content, hit, name: name0, person: (talk ? (hit ? 2 : PERSON_ONLY) : 0) + atMeBy });
    });
  }
  const hitConvs = new Set(all.filter(x => x.hit).map(x => x.m.conv));
  for (const x of all) x.score = x.content + (x.hit || hitConvs.has(x.m.conv) ? x.name : x.name * 0.3) + x.person;
  // 被 @ 的人后续发言（2026-11-10，H5）：布置任务时 @ 了谁，被 @ 的人之后几天在同一会话里的头几条发言，
  // 往往就是回应、提问或交差，即使和邮件没有共同词。触发的锚点：内容命中且带 @，或当前用户 @ 了邮件参与人。
  for (const a of all) {
    const ment = a.m.mentions || [];
    if (!ment.length || !(a.hit || (a.m.mine && ment.some(x => people.has(x))))) continue;
    const seen = new Map();
    for (const x of all) {
      if (x.m.conv !== a.m.conv || x.m.at <= a.m.at || x.m.at - a.m.at > FOLLOW_DAYS || !ment.includes(x.m.sender)) continue;
      const n = (seen.get(x.m.sender) || 0) + 1; seen.set(x.m.sender, n);
      if (n <= FOLLOW_N && !x.followed) { x.score += FOLLOW; x.followed = true; }
    }
  }
  all.sort((a, b) => b.score - a.score);
  const covered = new Set(), out = [];
  for (const x of all) {
    if (x.score <= 0) break;
    if (covered.has(x.m.id)) continue; // 已经在前面某个锚点的上下文里
    const win = x.list.filter((m, j) => (j <= x.i && x.i - j <= CTX_BEFORE && x.m.at - m.at <= CTX_BEFORE_MIN) || (j > x.i && j - x.i <= CTX_AFTER && m.at - x.m.at <= CTX_AFTER_MIN));
    for (const m of win) covered.add(m.id);
    out.push({ seg: win, score: x.score, hit: x.hit, conv: x.m.conv, anchor: x.m });
  }
  return out;
}

// 宁多勿漏 · 会话按人收（2026-11-10）：前 EXPAND_K 个锚点里，内容命中的锚点所在会话视为「在聊这件事」。
// 在这些会话里，从种子邮件发出到现在，收进：邮件参与人的发言、被这些锚点 @ 的人的发言、当前用户 @ 了上述人的发言，
// 每条再带上紧跟的 EXPAND_NEXT 条（接住「不行，只限正式员工」这类回答）。每个会话最多 EXPAND_CAP 条，按时间先后取。
// 模型在多轮评测里从未把无关真实消息挂进事项，所以召回阶段宁可多给。
function expandByPeople(ranked, byConv, people, seedAt) {
  const out = new Set();
  const top = ranked.slice(0, EXPAND_K).filter(x => x.hit);
  const convs = new Map();
  for (const x of top) {
    if (!convs.has(x.conv)) convs.set(x.conv, new Set(people));
    for (const n of x.anchor.mentions || []) convs.get(x.conv).add(n);
  }
  for (const [conv, who] of convs) {
    const list = (byConv.get(conv) || []).filter(m => m.at >= seedAt).sort((a, b) => a.at - b.at);
    let n = 0;
    for (let i = 0; i < list.length && n < EXPAND_CAP; i++) {
      const m = list[i];
      const keep = who.has(m.sender) || (m.mine && (m.mentions || []).some(x => who.has(x)));
      if (!keep) continue;
      for (const k of list.slice(i, i + 1 + EXPAND_NEXT)) if (!out.has(k.id)) { out.add(k.id); n++; }
      // 当前用户的回复（2026-11-10 诊断后）：别人提问或请求之后，当前用户在 REPLY_MIN 分钟内的头 REPLY_N 条发言一并收进。
      // 真实大群里中间常插进别人的消息，「下一条」接不住这种回复（H5 只限正式员工、H10 填 0 也要交表、C5 体检可以 13 号）。
      if (!m.mine) {
        let r = 0;
        for (let j = i + 1; j < list.length && list[j].at - m.at <= REPLY_MIN && r < REPLY_N; j++)
          if (list[j].mine) { r++; if (!out.has(list[j].id)) { out.add(list[j].id); n++; } }
      }
    }
  }
  return out;
}
const mailSenderName = from => {
  const addr = (String(from || '').match(/<([^>]+)>/) || [, from])[1].trim().toLowerCase();
  const p = byEmail.get(addr); return p ? p.welink_name : String(from || '');
};

// 真实群按消息数从多到少（B 难度把用例并进最活跃的群）。
function realGroupsOf(snap) {
  const count = new Map();
  for (const m of snap.messages) if (m.group && !m.mail) count.set(m.conv, (count.get(m.conv) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id, name: (snap.convs.find(c => c.id === id) || {}).name || id }));
}

// ---------- 主流程 ----------
function main() {
  const snap = loadSnapshots();
  if (!snap.files.length) { console.log(JSON.stringify({ ok: false, error: '没找到 Hub 的消息快照（raw-日期.json）。请确认助理页能看到消息，或用 --dir 指定助理目录。', dir: DIR.replace(HOME, '%USERPROFILE%') })); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const realGroups = realGroupsOf(snap);
  log(`读了 ${snap.files.length} 份快照，真实消息 ${snap.messages.length} 条，会话 ${snap.convs.length} 个，真实群 ${realGroups.length} 个`);

  const rows = [], local = [];
  for (const variant of ['A', 'B']) {
    if (variant === 'B' && !realGroups.length) continue;
    for (const c of DATA.cases) {
      const until0 = Date.parse(c.eval_time);
      const shift = Math.floor((snap.at - until0) / WEEK) * WEEK; // 整周平移，落在快照时间之前
      const until = until0 + shift;
      const caseMsgs = injected(c, shift, variant, realGroups);
      const pool = [...snap.messages.filter(m => m.at <= until), ...caseMsgs];
      const idf = idfOf(pool.map(m => m.text));
      for (const seedId of arr(c.seed_email_id)) {
        const seed0 = c.emails.find(e => e.msg_id === seedId);
        const seed = { ...seed0, sent_at: new Date(Date.parse(seed0.sent_at) + shift).toISOString() };
        for (const mode of MODES) {
        const r = recall(seed, pool, idf, until, mode);
        // 这个种子要找的：标准答案里属于本用例事项的消息（种子本身除外）。C7 两封种子共用一组答案，按种子分开时只算一次。
        const targets = caseMsgs.filter(m => m.relevant);
        const keyTargets = targets.filter(m => KEY_TYPES.has(m.type));
        for (const K of KS) {
          const ids = new Set([...r.mails, ...(r.expand || [])]);
          const segs = r.ranked.slice(0, K);
          for (const s of segs) for (const m of s.seg) ids.add(m.id);
          const got = targets.filter(m => ids.has(m.id)), gotKey = keyTargets.filter(m => ids.has(m.id));
          const realPicked = [...ids].filter(id => !caseMsgs.some(m => m.id === id)).length;
          const distract = caseMsgs.filter(m => !m.relevant && ids.has(m.id)).length;
          rows.push({ mode, variant, case: c.case_id, seed: seedId, K, targets: targets.length, recall: targets.length ? +(got.length / targets.length).toFixed(2) : 1,
            keyTargets: keyTargets.length, keyRecall: keyTargets.length ? +(gotKey.length / keyTargets.length).toFixed(2) : 1,
            candidates: ids.size, realNoise: realPicked, caseDistractors: distract, windowReal: r.windowSize,
            missed: targets.filter(m => !ids.has(m.id)).map(m => ({ id: m.id, type: m.type, text: m.text.trim().slice(0, 40) })) });
          if (flag('local-detail') && K === KS[Math.min(1, KS.length - 1)]) {
            local.push(`## ${mode} ${variant} ${c.case_id} 种子 ${seedId} · 前 ${K} 段`);
            for (const s of segs) local.push(`- [${s.score.toFixed(1)}] ${s.seg[0].real ? '真实' : '用例'}「${s.seg[0].convName || ''}」${s.seg.length} 条：${s.seg.map(m => m.text.slice(0, 30)).join(' | ')}`);
            local.push('');
          }
        }
        }
      }
    }
  }

  // C7 有两封种子：一封放假通知（不该有事项），一封考试。按用例合并时取考试那封的召回（放假通知本来就不需要找）。
  const keyOf = r => `${r.mode}|${r.variant}|${r.case}|${r.K}`, merged = new Map();
  for (const r of rows) { const k = keyOf(r), old = merged.get(k); if (!old || r.recall > old.recall) merged.set(k, r); }
  const final = [...merged.values()];
  const agg = (mode, variant, K) => {
    const xs = final.filter(r => r.mode === mode && r.variant === variant && r.K === K); if (!xs.length) return null;
    const sum = f => xs.reduce((a, r) => a + f(r), 0);
    return { mode, variant, K, recall: +(sum(r => r.recall * r.targets) / (sum(r => r.targets) || 1)).toFixed(2),
      keyRecall: +(sum(r => r.keyRecall * r.keyTargets) / (sum(r => r.keyTargets) || 1)).toFixed(2),
      avgCandidates: +(sum(r => r.candidates) / xs.length).toFixed(1), avgRealNoise: +(sum(r => r.realNoise) / xs.length).toFixed(1),
      avgWindowReal: +(sum(r => r.windowReal) / xs.length).toFixed(0) };
  };
  const overall = [];
  for (const mode of MODES) for (const v of ['A', 'B']) for (const K of KS) { const a = agg(mode, v, K); if (a) overall.push(a); }
  const summary = { at: new Date().toISOString(), snapshots: snap.files.length, realMessages: snap.messages.length, realConversations: snap.convs.length,
    realGroups: realGroups.length, settings: { modes: MODES, ctxBefore: CTX_BEFORE, ctxAfter: CTX_AFTER, ctxBeforeMin: CTX_BEFORE_MIN / 60000, ctxAfterMin: CTX_AFTER_MIN / 60000, expand: EXPAND, expandK: EXPAND_K, expandCap: EXPAND_CAP, expandNext: EXPAND_NEXT, replyMinutes: REPLY_MIN / 60000, replyN: REPLY_N, personOnly: PERSON_ONLY, atMe: AT_ME, follow: FOLLOW, followN: FOLLOW_N, followDays: FOLLOW_DAYS / 86400000, nameCap: NAME_CAP, minHit: MIN_HIT, floor: FLOOR, days: DAYS, gapMinutes: GAP / 60000, lookbackDays: LOOKBACK / 86400000, K: KS }, overall,
    perCase: final.map(({ missed, ...r }) => ({ ...r, missed: missed.map(m => m.id) })) };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const L = ['# 跨渠道跟进 · 召回评测报告', '', `用例文件：${path.basename(FILE)}`, '', `真实数据：${snap.files.length} 份快照，${snap.messages.length} 条消息，${snap.convs.length} 个会话（${realGroups.length} 个群）。报告里没有任何真实消息内容。`, '',
    'A = 用例群保持原名；B = 用例群消息并入你最活跃的真实群（更难，只能靠内容、发言人、时间）。',
    'K = 交给模型的对话片段数。分段：按间隔切段，取前 K 段；锚点：按单条消息打分，取前 K 条，各带前后几条上下文。',
    '召回率越高越好；混入的真实消息越少，后面模型要读的越少。', ''];
  const MODE_NAME = { segment: '分段', anchor: '锚点' };
  for (const mode of MODES) {
    L.push(`## 总体 · ${MODE_NAME[mode] || mode}`, '', '| 难度 | K | 召回率（全部相关） | 召回率（关键消息） | 平均候选条数 | 其中真实消息 | 时间窗口内真实消息总数 |', '|---|---|---|---|---|---|---|');
    for (const a of overall.filter(a => a.mode === mode)) L.push(`| ${a.variant} | ${a.K} | ${Math.round(a.recall * 100)}% | ${Math.round(a.keyRecall * 100)}% | ${a.avgCandidates} | ${a.avgRealNoise} | ${a.avgWindowReal} |`);
    L.push('');
  }
  L.push('## 逐个用例（只列有遗漏的）', '');
  for (const r of final.filter(r => r.missed.length)) L.push(`- ${MODE_NAME[r.mode] || r.mode} · ${r.variant} · K=${r.K} · ${r.case}：漏 ${r.missed.length}/${r.targets}，${r.missed.map(m => `${m.id}（${m.type}）「${m.text}」`).join('；')}`);
  if (!final.some(r => r.missed.length)) L.push('全部找到。');
  fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n'), 'utf8');
  if (local.length) fs.writeFileSync(path.join(OUT, 'local-only-detail.md'), '# 仅本机查看：含真实消息，不要外发\n\n' + local.join('\n'), 'utf8');
  console.log(JSON.stringify({ out: OUT, overall }, null, 2));
}

if (require.main === module) main();
module.exports = { FILE, tokens, recall, participants, loadSnapshots, injected, idfOf, realGroupsOf, DATA, ME, WEEK, KEY_TYPES, DIR, HOME };
