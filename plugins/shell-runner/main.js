'use strict';

const { spawn } = require('node:child_process');
const { mkdir, open } = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

let launching = false;
let started;

function validate(text) {
  if (typeof text !== 'string' || text.includes('\0')) {
    throw new Error('脚本必须是文本，且不能包含 NUL 字符。');
  }
}

leap.onInputChange(({ text, setList }) => {
  validate(text);
  setList(text.trim() ? [{
    id: 'run',
    title: '后台执行 Shell 脚本',
    description: '工作目录：用户主目录 · 按 Enter 启动并收起 Leap',
  }] : []);
});

leap.onSelect(async ({ text, signal }) => {
  // 窗口收起失败后再次回车，也不能重复创建已经启动的任务。
  if (started) return `已在后台启动（PID ${started.pid}）。日志：${started.logPath}`;
  if (launching) return '正在启动，请勿重复提交。';
  validate(text);
  if (!text.trim()) throw new Error('请输入要执行的 Shell 脚本。');

  launching = true;
  let output;
  try {
    const [home, logs] = await Promise.all([leap.getPath('home'), leap.getPath('logs')]);
    const directory = join(logs, 'shell-runner');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const logPath = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.log`);
    output = await open(logPath, 'wx', 0o600);
    if (signal.aborted) throw new Error('启动已取消。');

    // SDK 的标准输出用于通信；独立进程和文件句柄让任务在插件退出后继续运行。
    // 不把会话 signal 传给子进程，否则收起 Leap 时会连同后台任务一起取消。
    const child = spawn('/bin/zsh', ['-l', '-c', text], {
      cwd: home,
      detached: true,
      stdio: ['ignore', output.fd, output.fd],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    started = { pid: child.pid, logPath };
    child.unref();
    leap.log('Shell 后台任务已启动', { time: new Date().toISOString(), ...started });
  } catch (error) {
    leap.log('Shell 后台任务启动失败', error.message);
    throw new Error(`无法启动后台脚本：${error.message}`);
  } finally {
    // 子进程持有自己的描述符；父进程关文件失败不能被误报为脚本启动失败。
    if (output) await output.close().catch(error => leap.log('关闭日志句柄失败', error.message));
    launching = false;
  }

  try {
    await leap.hideMainWindow();
  } catch (error) {
    leap.log('后台任务已启动，但收起 Leap 失败', error.message);
    return `已在后台启动（PID ${started.pid}），窗口未收起。日志：${started.logPath}`;
  }
});
