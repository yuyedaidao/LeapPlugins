'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtemp, readFile, stat, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

const entry = path.resolve(__dirname, '../plugins/shell-runner/main.js');

function load(overrides = {}) {
  const calls = { spawn: [], mkdir: [], open: [], close: 0, unref: 0, hide: 0, logs: [] };
  const callbacks = {};
  const controller = new AbortController();
  const files = {
    async mkdir(...args) { calls.mkdir.push(args); },
    async open(...args) {
      calls.open.push(args);
      return { fd: 42, async close() { calls.close++; } };
    },
  };
  const leap = {
    onInputChange(callback) { callbacks.input = callback; },
    onSelect(callback) { callbacks.select = callback; },
    async getPath(name) { return name === 'home' ? '/test/home' : '/test/logs'; },
    async hideMainWindow() { calls.hide++; },
    log(...values) { calls.logs.push(values); },
    ...overrides.leap,
  };
  function fakeSpawn(...args) {
    calls.spawn.push(args);
    const child = new EventEmitter();
    child.pid = 123;
    child.unref = () => calls.unref++;
    queueMicrotask(() => child.emit(overrides.spawnError ? 'error' : 'spawn', overrides.spawnError));
    return child;
  }
  const modules = {
    'node:child_process': { spawn: overrides.spawn || fakeSpawn },
    'node:fs/promises': { ...files, ...overrides.files },
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    leap,
    require(name) { return modules[name] || require(name); },
  }, { filename: entry, timeout: 1000 });
  return {
    calls,
    controller,
    query(text) {
      let items;
      callbacks.input({ text, signal: controller.signal, setList(value) { items = value; } });
      return JSON.parse(JSON.stringify(items));
    },
    select(text, signal = controller.signal) { return callbacks.select({ text, signal }); },
  };
}

test('Shell 仅生成执行候选，空白和非法输入不能启动进程', async () => {
  const plugin = load();
  assert.deepEqual(plugin.query(' \n\t'), []);
  assert.equal(plugin.query('echo hello').length, 1);
  assert.equal(plugin.calls.spawn.length, 0);
  assert.throws(() => plugin.query('echo\0hello'), /NUL/);
  await assert.rejects(plugin.select(' \n'), /请输入/);
  await assert.rejects(plugin.select('echo\0hello'), /NUL/);
  assert.equal(plugin.calls.open.length, 0);
});

test('Shell 原样传入脚本，在主目录独立运行，关闭父句柄后才隐藏窗口', async () => {
  let plugin;
  plugin = load({ leap: { async hideMainWindow() {
    assert.equal(plugin.calls.close, 1);
    assert.equal(plugin.calls.unref, 1);
    plugin.calls.hide++;
  } } });
  const script = '  printf "%s\\n" "中文 $HOME" | cat > "带 空格.txt"\n';
  await plugin.select(script);
  const [executable, args, options] = plugin.calls.spawn[0];
  assert.equal(executable, '/bin/zsh');
  assert.deepEqual(Array.from(args), ['-l', '-c', script]);
  assert.equal(options.cwd, '/test/home');
  assert.equal(options.detached, true);
  assert.deepEqual(Array.from(options.stdio), ['ignore', 42, 42]);
  assert.equal(options.signal, undefined, '收起窗口的取消信号不能终止子进程');
  assert.equal(plugin.calls.mkdir[0][1].mode, 0o700);
  assert.equal(plugin.calls.open[0][1], 'wx');
  assert.equal(plugin.calls.open[0][2], 0o600);
  assert.equal(plugin.calls.hide, 1);
  assert.ok(!JSON.stringify(plugin.calls.logs).includes(script), '不额外记录脚本正文');
});

test('Shell 日志路径唯一，启动时间和 PID 可用于排查', async () => {
  const first = load();
  const second = load();
  await Promise.all([first.select('echo first'), second.select('echo second')]);
  assert.notEqual(first.calls.open[0][0], second.calls.open[0][0]);
  const metadata = first.calls.logs[0][1];
  assert.equal(metadata.pid, 123);
  assert.ok(Number.isFinite(Date.parse(metadata.time)));
  assert.equal(metadata.logPath, first.calls.open[0][0]);
});

test('Shell 启动失败保留窗口、释放日志句柄，并允许重试', async () => {
  const failure = new Error('spawn ENOENT');
  const plugin = load({ spawnError: failure });
  await assert.rejects(plugin.select('echo test'), /无法启动后台脚本.*ENOENT/);
  assert.equal(plugin.calls.close, 1);
  assert.equal(plugin.calls.unref, 0);
  assert.equal(plugin.calls.hide, 0);
  await assert.rejects(plugin.select('echo retry'), /ENOENT/);
  assert.equal(plugin.calls.spawn.length, 2);
});

test('Shell 日志创建失败不执行脚本，主目录获取失败也可读地反馈', async () => {
  for (const method of ['mkdir', 'open']) {
    const plugin = load({ files: { async [method]() { throw new Error('EACCES'); } } });
    await assert.rejects(plugin.select('echo test'), /无法启动后台脚本.*EACCES/);
    assert.equal(plugin.calls.spawn.length, 0);
    assert.equal(plugin.calls.hide, 0);
  }
  const plugin = load({ leap: { async getPath() { throw new Error('宿主接口不可用'); } } });
  await assert.rejects(plugin.select('echo test'), /宿主接口不可用/);
  assert.equal(plugin.calls.spawn.length, 0);
});

test('Shell 启动前取消时不创建进程，仍会释放文件句柄', async () => {
  const plugin = load();
  plugin.controller.abort();
  await assert.rejects(plugin.select('echo test'), /启动已取消/);
  assert.equal(plugin.calls.spawn.length, 0);
  assert.equal(plugin.calls.close, 1);
  assert.equal(plugin.calls.hide, 0);
});

test('Shell 同时回车或窗口收起失败后的重复回车只创建一个任务', async () => {
  const plugin = load({ leap: { async hideMainWindow() { throw new Error('收起失败'); } } });
  const first = plugin.select('echo test');
  assert.match(await plugin.select('echo test'), /正在启动/);
  assert.match(await first, /已在后台启动.*窗口未收起/);
  assert.match(await plugin.select('echo test'), /已在后台启动/);
  assert.equal(plugin.calls.spawn.length, 1);
  assert.equal(plugin.calls.close, 1);
});

test('Shell 父句柄关闭失败不会误报脚本启动失败', async () => {
  const plugin = load({ files: { async open() {
    return { fd: 42, async close() { throw new Error('close failed'); } };
  } } });
  await plugin.select('echo test');
  assert.equal(plugin.calls.hide, 1);
  assert.ok(plugin.calls.logs.some(values => values[0] === '关闭日志句柄失败'));
  assert.match(await plugin.select('echo test'), /已在后台启动/);
  assert.equal(plugin.calls.spawn.length, 1);
});

test('Shell 真实子进程在父插件进程退出后继续执行超过 3 秒，输出和权限正确', {
  skip: process.platform !== 'darwin' ? '真实 Shell 冒烟测试需要 macOS 的 /bin/zsh' : false,
  timeout: 12000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leap-shell-runner-'));
  const parentScript = `
    const fs = require('node:fs');
    const root = process.argv[1];
    let select;
    global.leap = {
      onInputChange() {}, onSelect(callback) { select = callback; },
      async getPath() { return root; }, log() {},
      async hideMainWindow() { process.stdout.write('hidden'); }
    };
    require(process.argv[2]);
    select({ text: 'sleep 3.2; /bin/pwd; printf "中文\\\\n"; printf "错误\\\\n" >&2; printf done > "完成 文件.txt"',
      signal: new AbortController().signal }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  try {
    const parent = spawn(process.execPath, ['-e', parentScript, directory, entry], {
      env: { ...process.env, ZDOTDIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    parent.stdout.on('data', value => { stdout += value; });
    parent.stderr.on('data', value => { stderr += value; });
    await new Promise((resolve, reject) => {
      parent.once('error', reject);
      parent.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || `父进程退出码 ${code}`)));
    });
    assert.equal(stdout, 'hidden');
    const result = path.join(directory, '完成 文件.txt');
    assert.equal(fs.existsSync(result), false, '父插件不能等待后台任务结束');
    const deadline = Date.now() + 7000;
    while ((!fs.existsSync(result) || fs.readFileSync(result, 'utf8') !== 'done') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await readFile(result, 'utf8'), 'done');
    const logs = path.join(directory, 'shell-runner');
    const [name] = fs.readdirSync(logs);
    const output = await readFile(path.join(logs, name), 'utf8');
    assert.ok(output.includes(fs.realpathSync(directory)));
    assert.ok(output.includes('中文'));
    assert.ok(output.includes('错误'));
    assert.equal((await stat(logs)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(logs, name))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
