'use strict';
// Diagnostic load comparison only. All mail fields stay in process memory.
const fs = require('node:fs');
const path = require('node:path');
const { execute } = require('./fix1-mail-probe.cjs');
const TIMEOUT = 30000;
const PLANS = { old: { pages: 10, gets: 30, gap: 0 }, new: { pages: 2, gets: 10, gap: 600 } };

async function runLoadProbe({ cli, mode, deadline }, {
  run = execute, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  shouldStop = () => false,
} = {}) {
  const calls = [], ids = new Set(), plan = PLANS[mode];
  let listsOK = 0, getsOK = 0;
  const result = reason => ({ status: reason === 'complete' ? 'complete' : 'stopped', reason,
    mode: plan ? mode : null, targetLists: plan?.pages ?? 0, targetGets: plan?.gets ?? 0,
    listsOK, getsOK, availableDistinctRead: ids.size, calls });
  if (!plan) return result('invalid_mode');
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(deadline))) return result('invalid_deadline');
  const until = Date.parse(deadline);
  if (!Number.isFinite(until)) return result('invalid_deadline');
  if (until <= now()) return result('window_passed');
  if (until - now() < 65000) return result('window_too_short');

  async function call(command, args) {
    if (shouldStop()) return { reason: 'operator_stop' };
    if (calls.length && plan.gap) await wait(plan.gap);
    if (shouldStop()) return { reason: 'operator_stop' };
    // Reserve the executor's timeout plus its bounded exit-confirmation time.
    if (until - now() < TIMEOUT + 10000) return { reason: 'window_too_short_for_next_call' };
    const r = await run(cli, args, TIMEOUT);
    const row = { command, sequence: calls.length + 1, started: new Date(r.started).toISOString(),
      ended: new Date(r.ended).toISOString(), elapsedMs: r.ended - r.started,
      code: r.code, exited: r.exited, stderrBytes: r.stderrBytes };
    calls.push(row);
    if (r.error || r.code !== 0 || !r.exited) return { reason: command + '_failed' };
    let value;
    try { value = JSON.parse(String(r.stdout).replace(/^\uFEFF/, '').trim()); row.jsonValid = true; }
    catch { row.jsonValid = false; return { reason: command + '_invalid_json' }; }
    return { row, value };
  }

  for (let page = 0; page < plan.pages; page++) {
    const r = await call('list', ['mail', 'list', '--folder-id', 'inbox', '--max', '100',
      '--is-read', '1', '--offset', String(page * 100)]);
    if (r.reason) return result(r.reason);
    if (!Array.isArray(r.value)) return result('list_not_array');
    r.row.rows = r.value.length;
    if (r.value.length > 100) return result('list_unexpected_count');
    // Fail closed on unexpected filtering/shape; never get an unread item.
    for (const mail of r.value) {
      if (!mail || mail.isRead !== true || typeof mail.itemId !== 'string' || !mail.itemId.trim()) {
        return result('list_unusable');
      }
      ids.add(mail.itemId);
    }
    listsOK++;
  }
  for (const id of [...ids].slice(0, plan.gets)) {
    const r = await call('get', ['mail', 'get', '--item-id', id, '--body-type', 'Text']);
    if (r.reason) return result(r.reason);
    if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return result('get_not_object');
    r.row.sameItem = r.value.itemId === id;
    r.row.isRead = r.value.isRead === true;
    r.row.bodyChars = typeof r.value.body === 'string' ? [...r.value.body].length : null;
    if (!r.row.sameItem || !r.row.isRead || r.row.bodyChars === null) return result('get_unexpected_fields');
    getsOK++;
  }
  if (shouldStop()) return result('operator_stop');
  return result(getsOK === plan.gets ? 'complete' : 'insufficient_read_mail');
}

async function main(argv) {
  const keys = new Set(['--cli', '--mode', '--deadline', '--stop-file']), options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!keys.has(argv[i]) || argv[i + 1] === undefined || options[argv[i]] !== undefined) throw Error('invalid_arguments');
    options[argv[i]] = argv[i + 1];
  }
  const cli = options['--cli'], stopFile = options['--stop-file'];
  if (!cli || !path.isAbsolute(cli) || !cli.toLowerCase().endsWith('.exe') || !fs.statSync(cli).isFile()) throw Error('invalid_cli');
  // The operator may create this marker to stop subsequent calls, without killing Outlook.
  if (!stopFile || !path.isAbsolute(stopFile) || !fs.statSync(path.dirname(stopFile)).isDirectory()) throw Error('invalid_stop_file');
  const r = await runLoadProbe({ cli, mode: options['--mode'], deadline: options['--deadline'] }, {
    shouldStop: () => fs.existsSync(stopFile),
  });
  console.log(JSON.stringify(r));
  process.exitCode = r.status === 'complete' ? 0 : 2;
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.log(JSON.stringify({ status: 'stopped', reason: 'preflight_failed', calls: [] })); process.exitCode = 2;
});
module.exports = { runLoadProbe };
