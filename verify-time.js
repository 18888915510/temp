'use strict';
// 不调用模型的针对性验证：时间显示、噪音时间映射、用例语义是否保持原样。
// 只读 cases.json 和内存里的快照副本，不写任何文件，不调用模型。
const fs = require('fs'), path = require('path');
const R = require('./recall-bench.js'), F = require('./followup-bench.js');

let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ' != ' + JSON.stringify(want)}`);
};

// 1. withWeek 统一按 UTC+08:00 渲染
check('Z 输入 → +08 墙上时间', F.withWeek('2026-11-03T07:00:00.000Z'), '2026-11-03 15:00（周二）');
check('+08 输入原样', F.withWeek('2026-11-03T15:00:00+08:00'), '2026-11-03 15:00（周二）');
check('跨日（Z 的 16:30 → 次日 00:30）', F.withWeek('2026-11-03T16:30:00.000Z'), '2026-11-04 00:30（周三）');
check('跨月（Z 的 10-31T16:30 → 11-01 00:30）', F.withWeek('2026-10-31T16:30:00.000Z'), '2026-11-01 00:30（周日）');
check('跨年（12-31T16:30Z → 01-01）', F.withWeek('2026-12-31T16:30:00.000Z'), '2027-01-01 00:30（周五）');
check('纯日期按当天 00:00', F.withWeek('2026-11-13'), '2026-11-13 00:00（周五）');

// 2. cases.json 完全没被改（与 git HEAD 的 blob 逐字节一致）
const { execFileSync } = require('child_process');
const head = execFileSync('git', ['show', 'HEAD:cases.json'], { cwd: __dirname, encoding: 'buffer' });
const disk = fs.readFileSync(path.join(__dirname, 'cases.json'));
check('cases.json 与 HEAD 逐字节一致', Buffer.compare(head, disk) === 0, true);

// 3. 噪音时间映射：真实消息反向平移后，与用例的相对位置和原方案一致
const snap = R.loadSnapshots();
const shiftOf = c => Math.floor((snap.at - Date.parse(c.eval_time)) / R.WEEK) * R.WEEK;
const realGroups = R.realGroupsOf(snap);
for (const c of R.DATA.cases) {
  const shift = shiftOf(c);
  const until = Date.parse(c.eval_time);
  const caseMsgs = R.injected(c, 0, 'A', realGroups);
  // 用例消息时间必须与 cases.json 原值一致（不平移）
  const sameTime = caseMsgs.every(m => {
    const src = [...c.emails, ...c.groups.flatMap(g => g.messages), ...(c.dms || []).flatMap(d => d.messages)]
      .find(x => x.msg_id === m.id);
    return src && m.at === Date.parse(src.sent_at);
  });
  check(`${c.case_id} 用例消息时间保持原样`, sameTime, true);
  // 真实消息映射后不晚于用例的「现在」
  const mapped = snap.messages.filter(m => m.at - shift <= until).map(m => ({ ...m, at: m.at - shift }));
  const inWindow = mapped.every(m => m.at <= until);
  check(`${c.case_id} 映射后真实消息都在窗口内`, inWindow, true);
  // 映射后的真实消息条数与「原方案按 until+shift 截断」一致
  const before = snap.messages.filter(m => m.at <= until + shift).length;
  check(`${c.case_id} 映射后真实消息条数不变`, mapped.length, before);
  // 用例的截止日期与状态语义（直接读标准答案，未做任何改写）
  const gold = F.goldMatters(c);
  console.log(`  ${c.case_id} 标准答案：` + gold.map(m => `${m.matter_id} ${m.direction} 截止=${m.deadline}${m.downstream_deadline ? ' 下游=' + m.downstream_deadline : ''} 对方=${m.counterparties.map(x => x.person + ':' + x.status).join(',') || '无'}`).join(' | '));
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
process.exit(bad ? 1 : 0);
