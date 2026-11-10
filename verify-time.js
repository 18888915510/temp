'use strict';
// 不调用模型、不读真实快照的确定性验证：时间显示、噪音时间映射、用例语义是否保持原样。
// 直接调用生产函数（F.withWeek / E.mapNoise / E.noiseShift），不复制公式。
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const F = require('./followup-bench.js');
const E = require('./e2e-bench.js');

let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ' != ' + JSON.stringify(want)}`);
};
const D = 86400000, W = 7 * D;

// 1. withWeek 统一按 UTC+08:00 渲染（保留原 6 项）
check('Z 输入 → +08 墙上时间', F.withWeek('2026-11-03T07:00:00.000Z'), '2026-11-03 15:00（周二）');
check('+08 输入原样', F.withWeek('2026-11-03T15:00:00+08:00'), '2026-11-03 15:00（周二）');
check('跨日（Z 的 16:30 → 次日 00:30）', F.withWeek('2026-11-03T16:30:00.000Z'), '2026-11-04 00:30（周三）');
check('跨月（10-31T16:30Z → 11-01）', F.withWeek('2026-10-31T16:30:00.000Z'), '2026-11-01 00:30（周日）');
check('跨年（12-31T16:30Z → 01-01）', F.withWeek('2026-12-31T16:30:00.000Z'), '2027-01-01 00:30（周五）');
check('纯日期按 +08 当天 00:00', F.withWeek('2026-11-13'), '2026-11-13 00:00（周五）');

// 2. noiseShift：正 / 负 / 零整周差，且总是整周倍数
const base = '2026-11-05T09:00:00+08:00';
check('零差', E.noiseShift(Date.parse(base), base), 0);
check('正差（快照晚 14 天）', E.noiseShift(Date.parse(base) + 14 * D, base), 14 * D);
check('负差（快照早 7 天）', E.noiseShift(Date.parse(base) - 7 * D, base), -7 * D);
check('不足一周向下取整为 0', E.noiseShift(Date.parse(base) + 3 * D, base), 0);
check('差值为整周倍数', E.noiseShift(Date.parse(base) + 10 * D, base) % W, 0);

// 3. mapNoise：只改真实消息的 at，输入对象不变，相对时间差按 shift 平移
const real = { id: 'R1', real: true, at: 1000 };
const caseMsg = { id: 'C2-G1-M1', real: false, at: 2000 };
const frozen = JSON.stringify(real);
for (const shift of [0, 7 * D, -7 * D]) {
  const mapped = E.mapNoise(real, shift);
  check(`mapNoise(${shift / D}周) 时间反向移动`, mapped.at, real.at - shift);
  check(`mapNoise(${shift / D}周) 输入对象未被改`, JSON.stringify(real) === frozen, true);
  check(`mapNoise(${shift / D}周) 返回新对象`, mapped !== real, true);
  check(`mapNoise(${shift / D}周) 用例消息原样返回`, E.mapNoise(caseMsg, shift), caseMsg);
  const before = real.at - caseMsg.at, after = E.mapNoise(real, shift).at - caseMsg.at;
  check(`mapNoise(${shift / D}周) 相对差按 shift 平移`, after - before, -shift);
}

// 4. 窗口边界（含「未来消息被排除」）：与主流程一致，按「原始时间 - shift <= until」过滤，再映射
const until = Date.parse(base);
const win = (shift) => [until + shift - 1, until + shift, until + shift + 1]
  .map(at => ({ real: true, at }))
  .filter(m => m.at - shift <= until)
  .map(m => E.mapNoise(m, shift).at);
check('零差：截止前/等于保留，未来排除', win(0), [until - 1, until]);
check('正差 14 天：截止前/等于保留，未来排除', win(14 * D), [until - 1, until]);
check('负差 7 天：截止前/等于保留，未来排除', win(-7 * D), [until - 1, until]);

// 5. cases.json 相对原始基线 b477817 完全未改
const BASE = 'b4778175006064943ec06a32ef4e59610d57db6c';
const blob = execFileSync('git', ['cat-file', 'blob', `${BASE}:cases.json`], { cwd: __dirname, encoding: 'buffer' });
const disk = fs.readFileSync(path.join(__dirname, 'cases.json'));
check('cases.json 与基线 b477817 逐字节一致', Buffer.compare(blob, disk) === 0, true);

// 6. 用例语义断言（只断言关键字段，不打印标准答案文本）
const d = JSON.parse(disk.toString('utf8'));
const gold = id => F.goldMatters(d.cases.find(c => c.case_id === id));
check('C1 拆成两个事项', gold('C1').length, 2);
check('C1 截止保持原样', gold('C1').map(m => m.deadline), ['2026-11-11', '2026-11-18']);
check('C2 是 relay 且上下游截止都在', gold('C2').map(m => [m.direction, m.deadline, m.downstream_deadline]), [['relay', '2026-11-04', '2026-11-07']]);
check('C4 派生任务保留', gold('C4').map(m => m.direction), ['cc_only', 'outbound']);
check('C5 两个交付物保留', gold('C5').length, 2);
check('C6 张伟保持 overdue', gold('C6')[0].counterparties.find(x => x.person === 'p_zhangwei').status, 'overdue');
check('C7 合并为一个事项', gold('C7').length, 1);

console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
process.exit(bad ? 1 : 0);
