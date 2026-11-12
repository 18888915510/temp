'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { runLoadProbe } = require('./fix1-load-probe.cjs');
const { execute } = require('./fix1-mail-probe.cjs');
const mails = Array.from({ length: 35 }, (_, i) => ({ itemId: 'synthetic secret ' + i, isRead: true }));
function fixture(mode = 'old', override = () => ({}), remaining = 300000) {
  let clock = Date.parse('2026-01-01T00:00:00Z'), stop = false;
  const args = [], starts = [], ends = [], waits = [];
  const options = { cli: 'fake.exe', mode, deadline: new Date(clock + remaining).toISOString() };
  const deps = { now: () => clock, shouldStop: () => stop,
    wait: async ms => { waits.push(ms); clock += ms; },
    run: async (_cli, argv, timeout) => {
      assert.equal(timeout, 30000); args.push(argv); starts.push(clock);
      const started = clock;
      const spec = override(argv, args.length) || {};
      clock += spec.duration ?? 2; ends.push(clock);
      return { started, ended: clock, code: 0, exited: true, error: '', stderrBytes: 0,
        stdout: JSON.stringify(argv[1] === 'list' ? mails : { itemId: argv[3], isRead: true, body: 'private body 中文😀' }), ...spec };
    } };
  return { options, deps, args, starts, ends, waits, stop: () => { stop = true; } };
}
for (const [mode, lists, gets, gap] of [['old', 10, 30, 0], ['new', 2, 10, 600]]) {
  test(mode + ': exact caps, distinct IDs, offsets, serial completion gaps and redaction', async () => {
    const h = fixture(mode); const r = await runLoadProbe(h.options, h.deps);
    assert.equal(r.status, 'complete'); assert.equal(r.listsOK, lists); assert.equal(r.getsOK, gets);
    assert.equal(h.args.length, lists + gets); assert.equal(r.availableDistinctRead, 35);
    assert.deepEqual(h.args.slice(0, lists).map(a => a.at(-1)), Array.from({ length: lists }, (_, i) => String(i * 100)));
    assert.ok(h.args.slice(0, lists).every(a => a[a.indexOf('--max') + 1] === '100' && a[a.indexOf('--is-read') + 1] === '1'));
    assert.equal(new Set(h.args.slice(lists).map(a => a[3])).size, gets);
    for (let i = 1; i < h.starts.length; i++) assert.equal(h.starts[i] - h.ends[i - 1], gap);
    assert.ok(!JSON.stringify(r).includes('synthetic secret')); assert.ok(!JSON.stringify(r).includes('private body'));
  });
}
for (const [value, expected] of [['[]', 'insufficient_read_mail'], [JSON.stringify([mails[0]]), 'insufficient_read_mail'],
  ['{}', 'list_not_array'], ['{', 'list_invalid_json'], ['[null]', 'list_unusable'],
  ['[{"isRead":true}]', 'list_unusable'], ['[{"itemId":"secret","isRead":false}]', 'list_unusable'],
  [JSON.stringify(Array(101).fill(mails[0])), 'list_unexpected_count']]) {
  test('list shape/filter safety: ' + expected + ' ' + value.slice(0, 25), async () => {
    const h = fixture('new', argv => argv[1] === 'list' ? { stdout: value } : {});
    const r = await runLoadProbe(h.options, h.deps); assert.equal(r.reason, expected);
    if (expected !== 'insufficient_read_mail') assert.equal(h.args.length, 1);
    else assert.ok(r.getsOK <= 1);
  });
}
for (const spec of [{ error: 'timeout', code: null }, { code: 1 }, { exited: false }, { error: 'spawn_failed', code: null }]) {
  test('failure stops without retry: ' + JSON.stringify(spec), async () => {
    const h = fixture('old', (_a, n) => n === 3 ? spec : {});
    assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'list_failed'); assert.equal(h.args.length, 3);
  });
}
for (const [stdout, reason] of [['bad', 'get_invalid_json'], ['[]', 'get_not_object'],
  ['{"itemId":"wrong","isRead":true,"body":"secret"}', 'get_unexpected_fields']]) {
  test('get validation stops later gets: ' + reason, async () => {
    const h = fixture('new', a => a[1] === 'get' ? { stdout } : {});
    assert.equal((await runLoadProbe(h.options, h.deps)).reason, reason); assert.equal(h.args.length, 3);
  });
}
test('get timeout stops all subsequent calls', async () => {
  const h = fixture('old', a => a[1] === 'get' ? { code: null, error: 'timeout' } : {});
  assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'get_failed'); assert.equal(h.args.length, 11);
});
for (const [remaining, reason] of [[-1, 'window_passed'], [64000, 'window_too_short']]) {
  test(reason + ': no calls', async () => {
    const h = fixture('old', undefined, remaining);
    assert.equal((await runLoadProbe(h.options, h.deps)).reason, reason); assert.equal(h.args.length, 0);
  });
}
test('partial window preserves counts and starts no command without cleanup reserve', async () => {
  const h = fixture('old', () => ({ duration: 26000 }), 65000);
  const r = await runLoadProbe(h.options, h.deps);
  assert.equal(r.reason, 'window_too_short_for_next_call'); assert.equal(r.listsOK, 1); assert.equal(h.args.length, 1);
});
test('operator stop during new-plan gap prevents next call', async () => {
  const h = fixture('new'); h.deps.wait = async () => h.stop();
  assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'operator_stop'); assert.equal(h.args.length, 1);
});
test('operator stop before first call', async () => {
  const h = fixture(); h.stop();
  assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'operator_stop'); assert.equal(h.args.length, 0);
});
test('operator stop during old-plan command prevents subsequent commands', async () => {
  const h = fixture('old', () => { h.stop(); });
  assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'operator_stop'); assert.equal(h.args.length, 1);
});
test('invalid mode and ambiguous deadline fail before invocation', async () => {
  const h = fixture(); h.options.mode = 'both';
  assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'invalid_mode');
  h.options.mode = 'old'; h.options.deadline = '2026-01-01 12:00:00';
  assert.equal((await runLoadProbe(h.options, h.deps)).reason, 'invalid_deadline'); assert.equal(h.args.length, 0);
});
test('real subprocess fake CLI exercises load mode; actual entry honors existing stop marker', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix1 load fake '));
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'fake CLI.cjs'), marker = path.join(dir, 'stop');
  fs.writeFileSync(file, `const a=process.argv.slice(2);console.log(JSON.stringify(a[1]==='list'?${JSON.stringify(mails)}:{itemId:a[3],isRead:true,body:'fake body'}));`);
  const r = await runLoadProbe({ cli: process.execPath, mode: 'new', deadline: new Date(Date.now() + 180000).toISOString() }, {
    run: (exe, args) => execute(exe, [file, ...args]), wait: async () => {},
  });
  assert.equal(r.status, 'complete'); assert.equal(r.calls.length, 12); assert.ok(r.calls.every(c => c.exited && c.code === 0));
  fs.writeFileSync(marker, '');
  const actual = await execute(process.execPath, [path.join(__dirname, 'fix1-load-probe.cjs'), '--cli', process.execPath,
    '--mode', 'old', '--deadline', new Date(Date.now() + 180000).toISOString(), '--stop-file', marker]);
  assert.equal(actual.code, 2); const parsed = JSON.parse(actual.stdout);
  assert.equal(parsed.reason, 'operator_stop'); assert.equal(parsed.calls.length, 0);
});
