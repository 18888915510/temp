'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execute, runProbe } = require('./fix1-mail-probe.cjs');
const ID = 'synthetic A\\B +/= "quote"';
const row = { itemId: ID, isRead: true };
const body = { ...row, body: 'synthetic body 中文😀' };
function harness(outputs, remaining = 180000) {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const args = [], starts = [], waits = [];
  const options = { cli: 'synthetic.exe', mode: 'mail', deadline: new Date(now + remaining).toISOString() };
  const deps = { now: () => now, wait: async ms => { waits.push(ms); now += ms; }, run: async (_cli, argv) => {
    args.push(argv); starts.push(now); const spec = outputs.shift(); assert.ok(spec, 'unexpected extra invocation');
    const started = now; now += spec.duration ?? 2;
    return { started, ended: now, code: 0, exited: true, error: '', stderrBytes: 0, stdout: '', ...spec };
  } };
  return { options, deps, args, starts, waits };
}
test('single-element array completes list → 600ms → get and never exposes mail values', async () => {
  const h = harness([{ stdout: JSON.stringify([row]) }, { stdout: JSON.stringify(body) }]);
  const r = await runProbe(h.options, h.deps);
  assert.equal(r.status, 'complete'); assert.equal(r.calls[0].rows, 1); assert.equal(r.calls[1].sameItem, true);
  assert.deepEqual(h.args[0], ['mail','list','--folder-id','inbox','--max','1','--is-read','1','--offset','0']);
  assert.deepEqual(h.args[1], ['mail','get','--item-id',ID,'--body-type','Text']);
  assert.deepEqual(h.waits, [600]); assert.equal(h.starts[1] - h.starts[0], 602);
  assert.equal(r.calls[1].bodyChars, [...body.body].length);
  assert.ok(!JSON.stringify(r).includes('synthetic')); assert.ok(!JSON.stringify(r).includes(body.body));
});
for (const [name, stdout, reason] of [
  ['empty list', '[]', 'list_empty'], ['object is not array', JSON.stringify(row), 'list_not_array'],
  ['multiple rows', JSON.stringify([row, row]), 'list_unexpected_count'], ['null', 'null', 'list_not_array'],
  ['malformed', '{', 'list_invalid_json'], ['unread', JSON.stringify([{ ...row, isRead: false }]), 'list_unusable'],
  ['missing ID', '[{"isRead":true}]', 'list_unusable'], ['null item', '[null]', 'list_unusable'],
  ['string true', JSON.stringify([{ ...row, isRead: 'true' }]), 'list_unusable'],
]) test(name + ': stop before get', async () => {
  const h = harness([{ stdout }]); const r = await runProbe(h.options, h.deps);
  assert.equal(r.reason, reason); assert.equal(h.args.length, 1);
});
for (const [name, spec] of [
  ['spawn error', { code: null, error: 'spawn_failed' }], ['nonzero exit', { code: 1 }],
  ['timeout', { code: null, error: 'timeout' }], ['unconfirmed exit', { exited: false }],
]) test(name + ': no retry or get', async () => {
  const h = harness([spec]); assert.equal((await runProbe(h.options, h.deps)).reason, 'list_failed'); assert.equal(h.args.length, 1);
});
for (const [remaining, reason] of [[-1, 'window_passed'], [64000, 'window_too_short']]) test(reason + ': no calls', async () => {
  const h = harness([], remaining); assert.equal((await runProbe(h.options, h.deps)).reason, reason); assert.equal(h.args.length, 0);
});
test('window consumed by first invocation: no late get', async () => {
  const h = harness([{ stdout: JSON.stringify([row]), duration: 36000 }], 65000);
  assert.equal((await runProbe(h.options, h.deps)).reason, 'window_too_short_for_get'); assert.equal(h.args.length, 1);
});
for (const [stdout, reason] of [['bad', 'get_invalid_json'], ['[]', 'get_not_object'],
  [JSON.stringify({ ...body, itemId: 'different' }), 'get_unexpected_fields'],
  [JSON.stringify({ ...body, isRead: false }), 'get_unexpected_fields'],
  [JSON.stringify({ ...row }), 'get_unexpected_fields']]) test('invalid get: ' + reason, async () => {
  const h = harness([{ stdout: JSON.stringify([row]) }, { stdout }]);
  assert.equal((await runProbe(h.options, h.deps)).reason, reason); assert.equal(h.args.length, 2);
});
test('get timeout: no retry', async () => {
  const h = harness([{ stdout: JSON.stringify([row]) }, { code: null, error: 'timeout', stdout: 'private partial' }]);
  const r = await runProbe(h.options, h.deps); assert.equal(r.reason, 'get_failed'); assert.equal(h.args.length, 2);
  assert.ok(!JSON.stringify(r).includes('private partial'));
});
test('version mode uses the same executor and no mail commands', async () => {
  const h = harness([{ stdout: '1.0.18' }]); h.options.mode = 'version';
  assert.equal((await runProbe(h.options, h.deps)).calls[0].version, '1.0.18'); assert.deepEqual(h.args, [['--version']]);
});
test('real subprocess: fake CLI with spaced path and quoted/backslash ID completes both stages', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix1 fake CLI '));
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'fake mail.cjs');
  fs.writeFileSync(file, `const row=${JSON.stringify(row)}, body=${JSON.stringify(body)};const a=process.argv.slice(2);if(a[0]==='mail'&&a[1]==='list')console.log(JSON.stringify([row]));else if(a[0]==='mail'&&a[1]==='get'&&a[3]===row.itemId)console.log(JSON.stringify(body));else process.exitCode=9;`);
  const r = await runProbe({ cli: process.execPath, mode: 'mail', deadline: new Date(Date.now() + 180000).toISOString() }, {
    run: (exe, args) => execute(exe, [file, ...args]),
  });
  assert.equal(r.status, 'complete'); assert.equal(r.calls.length, 2); assert.ok(r.calls.every(c => c.exited && c.code === 0));
});
test('real subprocess spawn failure is sanitized', async () => {
  const r = await execute(path.join(os.tmpdir(), 'nonexistent-fix1-CLI', 'absent.exe'), []);
  assert.equal(r.error, 'spawn_failed'); assert.equal(r.exited, true); assert.equal(r.code, null);
});
test('actual script entry receives exe path as argv, version only', async () => {
  const r = await execute(process.execPath, [path.join(__dirname, 'fix1-mail-probe.cjs'), '--cli', process.execPath, '--mode', 'version']);
  assert.equal(r.code, 0); const report = JSON.parse(r.stdout);
  assert.equal(report.status, 'complete'); assert.equal(report.calls[0].command, 'version');
  assert.equal(report.calls[0].version, process.versions.node);
});
test('real subprocess timeout terminates only its fake child', async () => {
  const r = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 100);
  assert.equal(r.error, 'timeout'); assert.equal(r.exited, true);
});
