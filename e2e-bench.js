'use strict';
// 跨渠道跟进 · 端到端评测（P0 第三步，不改 Hub 代码，只依赖 Node 22）。
// 把前两步串起来：用召回规则（锚点、前 K 条）从「真实消息 + 混进去的用例消息」里找候选 → 交给模型整理 → 和标准答案比对。
// 测的是：几十条真实无关消息混在候选里时，模型还能不能整理对；召回漏掉的消息对最终卡片影响多大。
//
// 隐私：真实消息会作为候选发给公司 CodeAgent 模型（和助理每日简报同一条通道）。
//       report.md / summary.json 只有数字和用例（编造）消息的编号，不含真实消息、群名、人名，可以上传。
//       发给模型的提问和模型原始输出含真实消息，只写在 local-only/ 里，不上传。
//
// 用法：node e2e-bench.js
//       node e2e-bench.js --model deepseek-v4.1-flash-1017 --k 20 --variants A,B --cases C1,C5
const fs = require('fs'), path = require('path');
const R = require('./recall-bench.js'), F = require('./followup-bench.js');

const argv = process.argv.slice(2), opt = (k, d) => {
  const eq = argv.find(a => a.startsWith('--' + k + '=')); if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const K = Number(opt('k', 20));
const VARIANTS = String(opt('variants', 'A,B')).split(',');
const PICK = opt('cases', 'all');
const PAR = Math.max(1, Number(opt('parallel', 2)));
const STAMP = new Date(Date.now() + 8 * 3600000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(opt('out', path.join(__dirname, 'e2e-' + STAMP)));
const log = (...a) => console.error('[e2e]', ...a);
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const iso = ms => new Date(ms).toISOString();

// 候选消息 → 给模型的材料。真实消息编成 R1、R2…（省字数，也方便统计误挂）；用例消息保留原编号。
// 用例消息一律用原始时间（不再平移），真实消息的时间已在主流程里映射到用例时间轴。
function buildMaterial(c, seeds, cands) {
  const ids = new Map(); let n = 0;
  const idOf = m => { if (!m.real) return m.id; if (!ids.has(m.id)) ids.set(m.id, 'R' + (++n)); return ids.get(m.id); };
  const L = ['## 邮件'];
  const caseMails = c.emails.filter(e => seeds.includes(e.msg_id) || cands.some(m => m.id === e.msg_id));
  for (const e of caseMails) {
    L.push(`[${e.msg_id}] ${seeds.includes(e.msg_id) ? '★用户转发给你的邮件 ' : ''}${F.withWeek(e.sent_at)}${e.in_reply_to ? `（回复 ${e.in_reply_to}）` : ''}`,
      `发件人：${e.from}`, `收件人：${e.to.join('；')}`, `抄送：${(e.cc || []).join('；') || '无'}`, `主题：${e.subject}`,
      `附件：${(e.attachments || []).join('、') || '无'}`, `正文：\n${e.body}`, '');
  }
  for (const m of cands.filter(m => m.mail && m.real)) L.push(`[${idOf(m)}] ${F.withWeek(iso(m.at))} 发件人：${m.sender} 主题：${m.subject}`, '');
  const byConv = new Map();
  for (const m of cands.filter(m => !m.mail)) { if (!byConv.has(m.conv)) byConv.set(m.conv, []); byConv.get(m.conv).push(m); }
  for (const list of byConv.values()) {
    list.sort((a, b) => a.at - b.at);
    L.push(list[0].group ? `## 群聊「${list[0].convName}」（只列出可能相关的片段）` : `## 私聊（与 ${list[0].convName}）`);
    for (const m of list) L.push(`[${idOf(m)}] ${F.withWeek(iso(m.at))} ${m.sender}：${m.text}`);
    L.push('');
  }
  return { text: L.join('\n'), realCount: ids.size, realIds: new Set(ids.values()) };
}

// 合成评测的噪音时间映射：用例消息、eval_time、正文、标准答案全部保持原样；
// 把真实噪音消息的时间整体反向移动（减 shift），使它们与用例的相对时间位置和原方案一致。
// 只改内存里的副本，真实快照文件不动。
function mapNoise(m, shift) { return m.real ? { ...m, at: m.at - shift } : m; }
// 整周差（可为正、负、零），只依赖传入的两个时间点，便于确定性测试。
function noiseShift(snapAt, evalTime) { return Math.floor((snapAt - Date.parse(evalTime)) / R.WEEK) * R.WEEK; }

async function main() {
  const snap = R.loadSnapshots();
  if (!snap.files.length) { console.log(JSON.stringify({ ok: false, error: '没找到 Hub 的消息快照（raw-日期.json）。请用 --dir 指定助理目录。' })); process.exit(1); }
  const realGroups = R.realGroupsOf(snap);
  fs.mkdirSync(path.join(OUT, 'local-only'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'ws'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'local-only', '说明.txt'), '本文件夹含真实消息（发给模型的提问和模型原始输出），只在本机查看，不要外发。\n', 'utf8');
  await F.initCli();
  const cases = R.DATA.cases.filter(c => PICK === 'all' || PICK.split(',').includes(c.case_id));
  log(`真实消息 ${snap.messages.length} 条 · 模型 ${F.MODEL}（${F.CLI}）· 锚点前 ${K} 条 · 难度 ${VARIANTS.join(',')} · 用例 ${cases.map(c => c.case_id).join(',')} · 输出 ${OUT}`);

  const jobs = [];
  for (const variant of VARIANTS) {
    if (variant === 'B' && !realGroups.length) continue;
    for (const c of cases) jobs.push(async () => {
      // 用例时间轴保持原样；真实噪音消息整体反向移动 shift，使相对位置与原方案一致。
      const until = Date.parse(c.eval_time), shift = noiseShift(snap.at, c.eval_time);
      const caseMsgs = R.injected(c, 0, variant, realGroups);
      const pool = [...snap.messages.filter(m => m.at - shift <= until).map(m => mapNoise(m, shift)), ...caseMsgs];
      const idf = R.idfOf(pool.map(m => m.text));
      const seeds = arr(c.seed_email_id), picked = new Set();
      for (const sid of seeds) {
        const e = c.emails.find(x => x.msg_id === sid);
        const r = R.recall(e, pool, idf, until, 'anchor');
        for (const id of r.mails) picked.add(id);
        for (const w of r.ranked.slice(0, K)) for (const m of w.seg) picked.add(m.id);
      }
      const cands = pool.filter(m => picked.has(m.id));
      const mat = buildMaterial(c, seeds, cands);
      const text = F.prompt(c, mat.text, c.eval_time);
      const tag = `${variant}-${c.case_id}`;
      fs.writeFileSync(path.join(OUT, 'local-only', `${tag}-prompt.txt`), text, 'utf8');
      const res = await F.run(text, path.join(OUT, 'ws'));
      fs.writeFileSync(path.join(OUT, 'local-only', `${tag}-output.txt`), res.text || res.error, 'utf8');
      const out = F.parseJson(res.text);
      const seen = new Set([...seeds, ...cands.filter(m => !m.real).map(m => m.id)]);
      const s = out ? F.score(c, out, { safe: true, seen }) : null;
      // 召回漏掉的相关消息（模型根本没看到）；模型把真实消息挂到了事项上（误挂）。
      const missedByRecall = caseMsgs.filter(m => m.relevant && !picked.has(m.id)).map(m => m.id);
      const misLinked = out ? arr(out.message_labels).filter(l => mat.realIds.has(l.msg_id) && arr(l.matter).length > 0).length : null;
      const extraFromNoise = out ? arr(out.matters).filter(p => {
        const own = arr(out.message_labels).filter(l => arr(l.matter).includes(p.id)).map(l => l.msg_id);
        return own.length > 0 && own.every(id => mat.realIds.has(id));
      }).length : null;
      log(`${tag}：候选 ${cands.length} 条（真实 ${mat.realCount}），${res.wallS}s，${!res.ok ? '调用失败' : !out ? '输出不是 JSON' : '已比对'}`);
      return { variant, c, res, out, s, cands: cands.length, real: mat.realCount, missedByRecall, misLinked, extraFromNoise };
    });
  }
  const results = await F.pool(jobs, PAR);

  const rate = v => v.all ? Math.round(v.ok / v.all * 100) + '%' : '-';
  const summary = { at: new Date().toISOString(), model: F.MODEL, cli: F.CLI, K, variants: VARIANTS, realMessages: snap.messages.length, byVariant: {}, perCase: [] };
  const L = ['# 跨渠道跟进 · 端到端评测报告', '', `模型 ${F.MODEL}（${F.CLI}）· 召回：锚点前 ${K} 条 · 真实消息 ${snap.messages.length} 条。报告里没有任何真实消息内容。`, '',
    'A = 用例群保持原名；B = 用例群消息并入你最活跃的真实群。', '「召回漏掉」= 模型根本没看到的相关消息；「误挂真实消息」= 模型把无关的真实消息算进了事项。', '',
    '时间口径：编造用例的发送时间、评测时间、正文和标准答案全部保持原样；真实噪音消息的时间在内存中整体反向平移（每个用例按其整周差），使噪音与用例的相对位置和原方案一致。真实快照文件未修改，这是合成评测的噪音时间映射。', ''];
  for (const variant of VARIANTS) {
    const xs = results.filter(r => r.variant === variant); if (!xs.length) continue;
    const tot = {};
    for (const x of xs) if (x.s) for (const [k, v] of Object.entries(x.s.by)) { tot[k] = tot[k] || { ok: 0, all: 0 }; tot[k].ok += v.ok; tot[k].all += v.all; }
    const scored = xs.filter(x => x.out);
    const agg = { metrics: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, { ok: v.ok, all: v.all }])),
      avgCandidates: +(xs.reduce((a, x) => a + x.cands, 0) / xs.length).toFixed(1), avgReal: +(xs.reduce((a, x) => a + x.real, 0) / xs.length).toFixed(1),
      missedByRecall: xs.reduce((a, x) => a + x.missedByRecall.length, 0), misLinked: scored.reduce((a, x) => a + x.misLinked, 0),
      extraFromNoise: scored.reduce((a, x) => a + x.extraFromNoise, 0), avgSeconds: +(xs.reduce((a, x) => a + x.res.wallS, 0) / xs.length).toFixed(1),
      failed: xs.filter(x => !x.out).map(x => x.c.case_id) };
    summary.byVariant[variant] = agg;
    L.push(`## 难度 ${variant}`, '', `平均候选 ${agg.avgCandidates} 条（其中真实消息 ${agg.avgReal} 条）· 平均耗时 ${agg.avgSeconds} 秒`,
      `召回漏掉相关消息 ${agg.missedByRecall} 条 · 误挂真实消息 ${agg.misLinked} 条 · 完全由真实消息生成的多余事项 ${agg.extraFromNoise} 个${agg.failed.length ? ` · 没拿到有效 JSON：${agg.failed.join('、')}` : ''}`, '',
      '| 指标 | 正确率 | 对/总 |', '|---|---|---|');
    for (const [k, v] of Object.entries(tot)) L.push(`| ${k} | ${rate(v)} | ${v.ok}/${v.all} |`);
    L.push('');
  }
  L.push('## 逐个用例（只列错的）', '');
  for (const x of results) {
    const bad = x.s ? x.s.checks.filter(k => !k.ok) : [];
    summary.perCase.push({ variant: x.variant, case: x.c.case_id, seconds: x.res.wallS, candidates: x.cands, real: x.real, json: !!x.out,
      missedByRecall: x.missedByRecall, misLinked: x.misLinked, extraFromNoise: x.extraFromNoise, wrong: bad.length });
    if (!x.out) { L.push(`- ${x.variant} · ${x.c.case_id}：没拿到有效 JSON`); continue; }
    if (!bad.length && !x.missedByRecall.length && !x.misLinked) continue;
    L.push(`### ${x.variant} · ${x.c.case_id} ${x.c.title}`);
    if (x.missedByRecall.length) L.push(`- 召回漏掉：${x.missedByRecall.join('、')}`);
    if (x.misLinked) L.push(`- 误挂真实消息 ${x.misLinked} 条`);
    for (const k of bad) L.push(`- [${k.metric}] ${k.detail}`);
    L.push('');
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n'), 'utf8');
  console.log(JSON.stringify({ out: OUT, byVariant: summary.byVariant }, null, 2));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { mapNoise, noiseShift, buildMaterial };
