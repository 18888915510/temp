'use strict';
// Diagnostic only. No mail content/IDs are printed or written to disk.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const TIMEOUT = 30000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function execute(file, args, timeoutMs = TIMEOUT) {
  return new Promise(resolve => {
    const started = Date.now();
    let child, out = '', bytes = 0, stderrBytes = 0, done = false, stopped = '', timer, cleanup;
    const finish = (code, exited, error = '') => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(cleanup);
      resolve({ code: Number.isInteger(code) ? code : null, exited, error: error || stopped,
        stdout: out, stderrBytes, started, ended: Date.now() });
    };
    const stop = reason => {
      if (stopped || done) return;
      stopped = reason;
      // Only the PID of the child created by this invocation, never a name search.
      if (process.platform === 'win32' && child?.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
        killer.on('error', () => { try { child.kill(); } catch {} });
        killer.on('close', code => { if (code && child.exitCode == null) { try { child.kill(); } catch {} } });
      } else { try { child?.kill(); } catch {} }
      cleanup = setTimeout(() => finish(null, false, reason + '_exit_unconfirmed'), 10000);
    };
    try { child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { finish(null, true, 'spawn_failed'); return; }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', s => { bytes += Buffer.byteLength(s); if (bytes > 8 * 1024 * 1024) stop('output_limit'); else out += s; });
    child.stderr.on('data', s => { stderrBytes += s.length; if (stderrBytes > 1024 * 1024) stop('stderr_limit'); });
    child.on('error', () => finish(null, !child.pid, 'spawn_failed'));
    child.on('close', code => finish(code, true));
    timer = setTimeout(() => stop('timeout'), timeoutMs);
  });
}
function parse(raw) { try { return { ok: true, value: JSON.parse(String(raw).replace(/^\uFEFF/, '').trim()) }; } catch { return { ok: false }; } }
function summary(command, r) {
  return { command, started: new Date(r.started).toISOString(), ended: new Date(r.ended).toISOString(),
    elapsedMs: r.ended - r.started, code: r.code, exited: r.exited, error: r.error, stderrBytes: r.stderrBytes };
}
async function runProbe({ cli, mode, deadline }, { run = execute, now = Date.now, wait = sleep } = {}) {
  const calls = [], result = reason => ({ status: reason === 'complete' ? 'complete' : 'stopped', reason, calls });
  if (mode === 'version') {
    const r = await run(cli, ['--version']);
    const row = summary('version', r); calls.push(row);
    row.version = String(r.stdout).match(/(?:^|[\s:])v?(\d+\.\d+\.\d+)\b/)?.[1] || null;
    return result(!r.error && r.code === 0 && r.exited && row.version ? 'complete' : 'version_failed');
  }
  if (mode !== 'mail') return result('invalid_mode');
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(deadline))) return result('invalid_deadline');
  const until = Date.parse(deadline);
  if (!Number.isFinite(until)) return result('invalid_deadline');
  if (until <= now()) return result('window_passed');
  if (until - now() < 65000) return result('window_too_short');
  const listed = await run(cli, ['mail', 'list', '--folder-id', 'inbox', '--max', '1', '--is-read', '1', '--offset', '0']);
  const lr = summary('list', listed); calls.push(lr);
  if (listed.error || listed.code !== 0 || !listed.exited) return result('list_failed');
  const decoded = parse(listed.stdout); lr.jsonValid = decoded.ok;
  if (!decoded.ok) return result('list_invalid_json');
  if (!Array.isArray(decoded.value)) return result('list_not_array');
  lr.rows = decoded.value.length;
  if (lr.rows === 0) return result('list_empty');
  if (lr.rows !== 1) return result('list_unexpected_count');
  const mail = decoded.value[0];
  if (!mail || mail.isRead !== true || typeof mail.itemId !== 'string' || !mail.itemId.trim()) return result('list_unusable');
  // JSON.parse keeps a one-element array intact. IDs remain data, never shell text.
  await wait(600);
  if (until - now() < TIMEOUT) return result('window_too_short_for_get');
  const got = await run(cli, ['mail', 'get', '--item-id', mail.itemId, '--body-type', 'Text']);
  const gr = summary('get', got); calls.push(gr);
  if (got.error || got.code !== 0 || !got.exited) return result('get_failed');
  const parsed = parse(got.stdout); gr.jsonValid = parsed.ok;
  if (!parsed.ok) return result('get_invalid_json');
  const value = parsed.value;
  if (!value || Array.isArray(value) || typeof value !== 'object') return result('get_not_object');
  gr.sameItem = value.itemId === mail.itemId; gr.isRead = value.isRead === true;
  gr.bodyChars = typeof value.body === 'string' ? [...value.body].length : null;
  if (!gr.sameItem || !gr.isRead || gr.bodyChars === null) return result('get_unexpected_fields');
  return result('complete');
}
async function main(argv) {
  const keys = new Set(['--cli', '--mode', '--deadline']), options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!keys.has(argv[i]) || argv[i + 1] === undefined || options[argv[i]] !== undefined) throw Error('invalid_arguments');
    options[argv[i]] = argv[i + 1];
  }
  const cli = options['--cli'];
  if (!cli || !path.isAbsolute(cli) || !fs.statSync(cli).isFile() || !cli.toLowerCase().endsWith('.exe')) throw Error('invalid_executable');
  const result = await runProbe({ cli, mode: options['--mode'], deadline: options['--deadline'] });
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'complete' ? 0 : 2;
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.log(JSON.stringify({ status: 'stopped', reason: 'preflight_failed', calls: [] })); process.exitCode = 2;
});
module.exports = { execute, runProbe };
