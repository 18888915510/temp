'use strict';
// 只读诊断（2026-11-10）：查清召回为什么漏掉某条消息、慢调用为什么慢。只输出数字和编造用例的编号，不含任何真实消息内容、群名、人名。
// 不调模型、不调 WeLink、不改任何文件（只写 diag-日期时间/report.md 和 summary.json）。
//
// 用法：node diag.js --file holdout.json --targets H5-G1-M3,H5-G1-M4
//       node diag.js --file holdout2.json --targets H10-G1-M2,H10-G1-M3
//       node diag.js --e2e e2e-2026-11-10T11-47-18      （慢调用：只统计提问和输出的字数与耗时）
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2), opt = (k, d) => {
  const eq = argv.find(a => a.startsWith('--' + k + '=')); if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const STAMP = new Date(Date.now() + 8 * 3600000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(opt('out', path.join(__dirname, 'diag-' + STAMP)));
const L = ['# 只读诊断', '', '只含数字和编造用例的编号，不含真实消息内容、群名、人名。', ''];
const summary = {};

// ---------- 慢调用 ----------
const E2E = opt('e2e', '');
if (E2E) {
  const dir = path.resolve(__dirname, E2E), lo = path.join(dir, 'local-only');
  const sum = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const rows = sum.perCase.map(r => {
    const tag = `${r.variant}-${r.case}`;
    const size = f => { try { return fs.readFileSync(path.join(lo, f), 'utf8').length; } catch { return null; } };
    let out = null, matters = null, labels = null;
    try { const t = fs.readFileSync(path.join(lo, `${tag}-output.txt`), 'utf8'); out = t.length;
      const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); matters = (j.matters || []).length; labels = (j.message_labels || []).length; } catch {}
    return { tag, seconds: r.seconds, candidates: r.candidates, promptChars: size(`${tag}-prompt.txt`), outputChars: out, matters, labels };
  }).sort((a, b) => b.seconds - a.seconds);
  summary.e2e = { folder: E2E, rows };
  L.push(`## 慢调用 · ${E2E}`, '', '| 运行 | 秒 | 候选条数 | 提问字数 | 输出字数 | 事项数 | 标注条数 |', '|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.tag} | ${r.seconds} | ${r.candidates} | ${r.promptChars ?? '-'} | ${r.outputChars ?? '-'} | ${r.matters ?? '-'} | ${r.labels ?? '-'} |`);
  L.push('', '看点：最慢那次的输出字数是否明显比别的多（输出长 → 慢）；如果字数相近却慢很多，更像服务端波动。', '');
}

// ---------- 召回漏消息 ----------
const TARGETS = String(opt('targets', '')).split(',').filter(Boolean);
if (TARGETS.length) {
  const R = require('./recall-bench.js');
  const snap = R.loadSnapshots(), realGroups = R.realGroupsOf(snap);
  const K = Number(opt('k', 20));
  const caseNames = new Set(R.DATA.people.map(p => p.welink_name));
  summary.recall = [];
  L.push(`## 召回 · ${path.basename(R.FILE)} · 锚点 K=${K}`, '');
  for (const variant of ['A', 'B']) {
    const byCase = new Map();
    for (const t of TARGETS) { const cid = t.split('-')[0]; if (!byCase.has(cid)) byCase.set(cid, []); byCase.get(cid).push(t); }
    for (const [cid, targets] of byCase) {
      const c = R.DATA.cases.find(x => x.case_id === cid); if (!c) continue;
      const until0 = Date.parse(c.eval_time), shift = Math.floor((snap.at - until0) / R.WEEK) * R.WEEK, until = until0 + shift;
      const caseMsgs = R.injected(c, shift, variant, realGroups);
      const pool = [...snap.messages.filter(m => m.at <= until), ...caseMsgs];
      const idf = R.idfOf(pool.map(m => m.text));
      const seedId = [].concat(c.seed_email_id)[0], e = c.emails.find(x => x.msg_id === seedId);
      const r = R.recall({ ...e, sent_at: new Date(Date.parse(e.sent_at) + shift).toISOString() }, pool, idf, until, 'anchor');
      const people = R.participants(e);
      const top = r.ranked.slice(0, K), topIds = new Set(top.flatMap(x => x.seg.map(m => m.id)));
      const expand = r.expand || new Set();
      const host = caseMsgs.find(m => targets.includes(m.id));
      const hostConv = host ? host.conv : null;
      // 扩展集合里各类消息的条数（只数，不看内容）
      const exp = pool.filter(m => expand.has(m.id));
      const expInHost = exp.filter(m => m.conv === hostConv);
      const realSameName = expInHost.filter(m => m.real && caseNames.has(m.sender)).length;
      const realMine = expInHost.filter(m => m.real && m.mine).length;
      const caseInHost = expInHost.filter(m => !m.real).length;
      const hostAnchored = top.some(x => x.conv === hostConv && x.hit);
      const row = { variant, case: cid, hostIsRealGroup: !!(hostConv && !String(hostConv).startsWith('case:')), hostConvAnchoredWithHit: hostAnchored,
        expandTotal: expand.size, expandInHost: expInHost.length, expandCap: 60, capReached: expInHost.length >= 60,
        expandInHost_realSameNameAsCasePeople: realSameName, expandInHost_realMine: realMine, expandInHost_caseMsgs: caseInHost,
        realMessagesInHostSinceSeed: pool.filter(m => m.real && m.conv === hostConv && m.at >= Date.parse(e.sent_at) + shift && m.at <= until).length,
        targets: targets.map(id => {
          const m = caseMsgs.find(x => x.id === id);
          const rank = r.ranked.findIndex(x => x.seg.some(y => y.id === id));
          const all = r.ranked.length;
          return { id, sender: m ? (m.mine ? '当前用户' : m.sender) : '?', inTopK: topIds.has(id), inExpand: expand.has(id), rankOfSegment: rank < 0 ? null : rank + 1, rankedTotal: all,
            senderIsParticipant: m ? people.has(m.sender) : null, found: topIds.has(id) || expand.has(id) || r.mails.has(id) };
        }) };
      summary.recall.push(row);
      L.push(`### ${variant} · ${cid}`, '',
        `- 用例消息所在会话：${row.hostIsRealGroup ? '并入的真实群' : '用例自己的群'}；该会话里有内容命中的锚点进了前 ${K}：${row.hostConvAnchoredWithHit ? '是' : '否'}`,
        `- 按人扩展：共 ${row.expandTotal} 条，其中该会话 ${row.expandInHost} 条（上限 60，${row.capReached ? '**已满**' : '未满'}）；该会话里：真实消息且发言人和用例人物同名 ${realSameName} 条、当前用户的真实消息 ${realMine} 条、用例消息 ${caseInHost} 条`,
        `- 该会话自种子邮件以来的真实消息：${row.realMessagesInHostSinceSeed} 条`);
      for (const t of row.targets) L.push(`- ${t.id}（${t.sender}，${t.senderIsParticipant ? '是' : '不是'}邮件参与人）：${t.found ? '找到' : '**没找到**'}；在前 ${K}：${t.inTopK ? '是' : '否'}；在按人扩展：${t.inExpand ? '是' : '否'}；所在片段排名：${t.rankOfSegment ?? '无'} / ${t.rankedTotal}`);
      L.push('');
    }
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n'), 'utf8');
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(L.join('\n'));
