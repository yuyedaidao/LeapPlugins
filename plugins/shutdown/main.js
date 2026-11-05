'use strict';

const { execFile, spawn } = require('node:child_process');
const { mkdir, open, readFile, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const PLUGIN_ID = 'com.padding.leap.shutdown';
const MAX_MINUTES = 7 * 24 * 60;
const STATE_NAME = 'state.json';
const UNIT_MINUTES = [
  [/^(小时|个小时|h|hr|hrs|hour|hours)$/i, 60],
  [/^(分钟|分|m|min|mins|minute|minutes)$/i, 1],
];

// System Events 需要一次「自动化」授权；首次安排时读取无关紧要的信息，把授权弹窗提前到安排时。
const EVENT_SCRIPT = (command) => `/usr/bin/osascript -e 'tell application "System Events" to ${command}'`;

let busy = false;

function parse(text) {
  const value = String(text ?? '').trim();
  if (!value) return { kind: 'menu' };
  if (/^(取消|停止|cancel|off)$/i.test(value)) return { kind: 'cancel' };
  const matched = /^(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]*)$/.exec(value);
  const invalid = () => new Error('无法识别的时长，可输入 30、30分钟、1.5h 或「取消」。');
  if (!matched) throw invalid();
  let scale = 1;
  if (matched[2]) {
    const unit = UNIT_MINUTES.find(([pattern]) => pattern.test(matched[2]));
    if (!unit) throw invalid();
    scale = unit[1];
  }
  const minutes = Math.round(Number(matched[1]) * scale);
  if (minutes > MAX_MINUTES) throw new Error('最长支持 7 天。');
  return minutes < 1 ? { kind: 'now' } : { kind: 'schedule', minutes };
}

function label(minutes) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (rest || !parts.length) parts.push(`${rest} 分钟`);
  return parts.join(' ');
}

function clock(date) {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  return date.toDateString() === today.toDateString() ? time : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function cancelItem(state) {
  if (!state) return { id: 'cancel', title: '取消定时关机', description: '当前没有定时关机任务' };
  const remaining = Math.max(1, Math.round((state.fireAt - Date.now()) / 60000));
  return {
    id: 'cancel',
    title: '取消定时关机',
    description: `将于 ${clock(new Date(state.fireAt))} 关机（剩余 ${label(remaining)}）`,
  };
}

function scheduleItem(minutes) {
  const fireAt = Date.now() + minutes * 60000;
  return { id: 'schedule', title: `${label(minutes)}后关机`, description: clock(new Date(fireAt)) };
}

async function paths() {
  const directory = join(await leap.getPath('userData'), 'PluginData', PLUGIN_ID);
  return { directory, file: join(directory, STATE_NAME) };
}

async function readState() {
  const { file } = await paths();
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`无法读取定时关机记录：${error.message}`);
  }
  try {
    const state = JSON.parse(text);
    if (!Number.isInteger(state?.pid) || !Number.isFinite(state?.fireAt) || typeof state?.token !== 'string' || !state.token) {
      return null;
    }
    return state;
  } catch (error) {
    leap.log('定时关机记录无法解析', error.message);
    return null;
  }
}

async function writeState(state) {
  const { directory, file } = await paths();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
}

async function clearState() {
  const { file } = await paths();
  await unlink(file).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// 只终止命令里仍然带着本次 token 的进程，避免 PID 复用后误杀其它进程组。
async function stop(state) {
  let command = '';
  try {
    command = await run('/bin/ps', ['-p', String(state.pid), '-o', 'command=']);
  } catch (error) {
    leap.log('查询关机任务进程失败', error.message);
  }
  if (!command.includes(state.token)) return false;
  try {
    // detached 子进程是进程组组长，负 PID 连同等待中的 sleep 一起终止。
    process.kill(-state.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  return true;
}

async function launch(fireAt, token) {
  const [home, logs] = await Promise.all([leap.getPath('home'), leap.getPath('logs')]);
  const directory = join(logs, 'shutdown');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const logPath = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.log`);
  let output;
  try {
    output = await open(logPath, 'wx', 0o600);
    // 按绝对时间等待，系统休眠时不会推迟关机；注释里的 token 供取消时校验进程身份。
    const script = [
      `# ${token}`,
      `${EVENT_SCRIPT('return name of first process')} >/dev/null 2>&1`,
      `while [ "$(/bin/date +%s)" -lt ${Math.floor(fireAt / 1000)} ]; do /bin/sleep 10; done`,
      `exec ${EVENT_SCRIPT('shut down')}`,
    ].join('\n');
    const child = spawn('/bin/zsh', ['-l', '-c', script], {
      cwd: home,
      detached: true,
      stdio: ['ignore', output.fd, output.fd],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    leap.log('关机任务已启动', { time: new Date().toISOString(), pid: child.pid, fireAt: new Date(fireAt).toISOString(), logPath });
    return { pid: child.pid, logPath };
  } catch (error) {
    leap.log('关机任务启动失败', error.message);
    throw new Error(`无法启动关机任务：${error.message}`);
  } finally {
    if (output) await output.close().catch(error => leap.log('关闭日志句柄失败', error.message));
  }
}

async function hide() {
  try {
    await leap.hideMainWindow();
  } catch (error) {
    leap.log('收起 Leap 失败', error.message);
  }
}

async function notify(body) {
  try {
    await leap.showNotification(body);
  } catch (error) {
    // 通知权限被拒不能算关机安排失败。
    leap.log('关机通知发送失败', error.message);
  }
}

async function shutDownNow() {
  const token = `leap-shutdown-${Date.now()}-${randomUUID()}`;
  const { logPath } = await launch(Date.now(), token);
  await hide();
  return `正在关机。日志：${logPath}`;
}

async function schedule(minutes) {
  const fireAt = Date.now() + minutes * 60000;
  const previous = await readState();
  if (previous) await stop(previous);
  const token = `leap-shutdown-${fireAt}-${randomUUID()}`;
  const { pid, logPath } = await launch(fireAt, token);
  try {
    await writeState({ pid, fireAt, minutes, token });
  } catch (error) {
    // 记录写不进去就不能留下无法取消的关机任务。
    try { process.kill(-pid, 'SIGTERM'); } catch (ignored) { /* 进程可能已退出 */ }
    throw new Error(`无法保存定时关机记录：${error.message}`);
  }
  await notify(`已安排在 ${clock(new Date(fireAt))} 关机（${label(minutes)}后）。`);
  await hide();
  return `已安排在 ${clock(new Date(fireAt))} 关机，日志：${logPath}`;
}

async function cancelSchedule() {
  const state = await readState();
  if (!state) return '当前没有定时关机任务。';
  const stopped = await stop(state);
  await clearState();
  const message = stopped
    ? `已取消定时关机（原定 ${clock(new Date(state.fireAt))}）。`
    : '定时关机已失效，记录已清理。';
  await notify(message);
  await hide();
  return message;
}

leap.onInputChange(async ({ text, setList }) => {
  const action = parse(text);
  if (action.kind === 'cancel') {
    setList([cancelItem(await readState())]);
  } else if (action.kind === 'schedule') {
    setList([scheduleItem(action.minutes)]);
  } else if (action.kind === 'now') {
    setList([{ id: 'now', title: '立即关机', description: '立即执行，没有确认步骤' }]);
  } else {
    setList([
      { id: 'now', title: '立即关机', description: '立即执行，没有确认步骤' },
      cancelItem(await readState()),
    ]);
  }
});

leap.onSelect(async ({ text, item }) => {
  if (busy) return '正在执行，请勿重复提交。';
  busy = true;
  try {
    const action = parse(text);
    if (action.kind === 'cancel' || (action.kind === 'menu' && item.id === 'cancel')) return await cancelSchedule();
    if (action.kind === 'schedule') return await schedule(action.minutes);
    if (action.kind === 'now' || (action.kind === 'menu' && item.id === 'now')) return await shutDownNow();
    throw new Error('无效操作。');
  } finally {
    busy = false;
  }
});
