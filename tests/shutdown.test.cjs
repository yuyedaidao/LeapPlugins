'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const entry = path.resolve(__dirname, '../plugins/shutdown/main.js');
const STATE = '/test/user/PluginData/com.padding.leap.shutdown/state.json';

function load(overrides = {}) {
  const calls = {
    spawn: [], execFile: [], mkdir: [], open: [], writeFile: [], close: 0, unref: 0,
    hide: 0, notify: [], kill: [], logs: [], files: new Map(),
  };
  const callbacks = {};
  const controller = new AbortController();
  const files = {
    async mkdir(...args) { calls.mkdir.push(args); },
    async open(...args) {
      calls.open.push(args);
      if (overrides.openError) throw overrides.openError;
      return { fd: 42, async close() { calls.close++; } };
    },
    async readFile(file) {
      if (!calls.files.has(file)) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = 'ENOENT';
        throw error;
      }
      return calls.files.get(file);
    },
    async writeFile(file, data, options) {
      if (overrides.writeError) throw overrides.writeError;
      calls.writeFile.push([file, data, options]);
      calls.files.set(file, data);
    },
    async unlink(file) {
      if (!calls.files.has(file)) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = 'ENOENT';
        throw error;
      }
      calls.files.delete(file);
    },
  };
  const leap = {
    onInputChange(callback) { callbacks.input = callback; },
    onSelect(callback) { callbacks.select = callback; },
    async getPath(name) {
      if (name === 'userData') return '/test/user';
      if (name === 'home') return '/test/home';
      if (name === 'logs') return '/test/logs';
      throw new Error(`未知路径 ${name}`);
    },
    async hideMainWindow() { calls.hide++; },
    async showNotification(body) { calls.notify.push(body); },
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
  function fakeExecFile(file, args, options, callback) {
    calls.execFile.push([file, args]);
    const output = overrides.ps ? overrides.ps(file, args) : null;
    queueMicrotask(() => (output === null
      ? callback(Object.assign(new Error('exit 1'), { code: 1 }), '')
      : callback(null, output)));
  }
  const modules = {
    'node:child_process': { spawn: overrides.spawn || fakeSpawn, execFile: fakeExecFile },
    'node:fs/promises': { ...files, ...overrides.files },
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    leap,
    process: { kill: (pid, signal) => calls.kill.push([pid, signal]) },
    require(name) { return modules[name] || require(name); },
  }, { filename: entry, timeout: 1000 });
  return {
    calls,
    controller,
    async query(text) {
      let items;
      await callbacks.input({ commandID: 'shutdown.run', text, signal: controller.signal, setList(value) { items = value; } });
      return JSON.parse(JSON.stringify(items));
    },
    select(text, item = { id: 'schedule', title: '' }) {
      return callbacks.select({ commandID: 'shutdown.run', text, item, signal: controller.signal });
    },
    async selectItem(id) {
      return callbacks.select({ commandID: 'shutdown.run', text: '', item: { id, title: '' }, signal: controller.signal });
    },
    state() {
      const text = calls.files.get(STATE);
      return text === undefined ? null : JSON.parse(text);
    },
    seed(value) { calls.files.set(STATE, value); },
  };
}

test('关机空输入给出立即关机与取消两项，没有安排时如实说明', async () => {
  const plugin = load();
  const items = await plugin.query('');
  assert.deepEqual(items.map(item => item.id), ['now', 'cancel']);
  assert.equal(items[1].description, '当前没有定时关机任务');
  assert.equal(plugin.calls.spawn.length, 0);
});

test('关机时长支持分钟、小时、小数与默认分钟，0 归一化为立即关机', async () => {
  const plugin = load();
  assert.equal((await plugin.query('30'))[0].title, '30 分钟后关机');
  assert.equal((await plugin.query('30分钟'))[0].title, '30 分钟后关机');
  assert.equal((await plugin.query('1.5h'))[0].title, '1 小时 30 分钟后关机');
  assert.equal((await plugin.query('2小时'))[0].title, '2 小时后关机');
  assert.equal((await plugin.query('1小时'))[0].title, '1 小时后关机');
  assert.equal((await plugin.query('10080'))[0].title, '7 天后关机');
  assert.equal((await plugin.query('0'))[0].id, 'now');
  assert.match((await plugin.query('30'))[0].description, /^\d{2}:\d{2}$/);
  assert.equal((await plugin.query('取消'))[0].id, 'cancel');
  assert.equal((await plugin.query('CANCEL'))[0].id, 'cancel');
});

test('关机无法识别或超过七天的输入报中文错误，且不启动进程', async () => {
  const plugin = load();
  for (const text of ['abc', '1天', '90s', '1小时30分', '-5', '1e3']) {
    await assert.rejects(plugin.query(text), /无法识别的时长/, text);
  }
  await assert.rejects(plugin.query('10081'), /最长支持 7 天/);
  assert.equal(plugin.calls.spawn.length, 0);
  assert.equal(plugin.calls.open.length, 0);
});

test('关机定时：detached zsh 脚本按绝对时间等待，写入状态并通知后收起 Leap', async () => {
  const plugin = load();
  const before = Date.now();
  const message = await plugin.select('30');
  const [executable, args, options] = plugin.calls.spawn[0];
  assert.equal(executable, '/bin/zsh');
  assert.deepEqual(Array.from(args).slice(0, 2), ['-l', '-c']);
  assert.equal(options.detached, true);
  assert.deepEqual(Array.from(options.stdio), ['ignore', 42, 42]);
  assert.equal(options.signal, undefined, '收起窗口的取消信号不能终止关机任务');
  assert.equal(plugin.calls.mkdir[0][1].mode, 0o700);
  assert.equal(plugin.calls.open[0][1], 'wx');
  assert.equal(plugin.calls.open[0][2], 0o600);

  const state = plugin.state();
  assert.equal(state.pid, 123);
  assert.equal(state.minutes, 30);
  assert.ok(state.fireAt >= before + 30 * 60000 && state.fireAt <= Date.now() + 30 * 60000);
  const script = args[2];
  assert.ok(script.includes(`# ${state.token}`), '脚本注释里带唯一 token');
  assert.ok(script.includes(`-lt ${Math.floor(state.fireAt / 1000)}`), '按绝对时间等待');
  assert.ok(script.includes('/bin/date +%s'));
  assert.ok(script.includes('System Events'));
  assert.ok(script.includes('shut down'));
  assert.equal(plugin.calls.unref, 1);
  assert.equal(plugin.calls.hide, 1);
  assert.equal(plugin.calls.notify.length, 1);
  assert.match(plugin.calls.notify[0], /^已安排在 \d{2}:\d{2} 关机（30 分钟后）。$/);
  assert.match(message, /^已安排在 .* 关机，日志：\/test\/logs\/shutdown\/.*\.log$/);
});

test('关机立即执行不写状态文件也不发通知', async () => {
  const plugin = load();
  await plugin.selectItem('now');
  assert.equal(plugin.calls.spawn.length, 1);
  assert.equal(plugin.calls.writeFile.length, 0);
  assert.equal(plugin.state(), null);
  assert.equal(plugin.calls.notify.length, 0);
  assert.equal(plugin.calls.hide, 1);
  const script = plugin.calls.spawn[0][1][2];
  assert.notEqual(script.indexOf('while'), -1, '立即关机也走同一脚本，条件已满足');
});

test('关机取消校验进程命令里的 token 后终止整个进程组并清理记录', async () => {
  const fireAt = Date.now() + 600000;
  const plugin = load({ ps: () => '# leap-shutdown-test-token' });
  plugin.seed(JSON.stringify({ pid: 900, fireAt, minutes: 10, token: 'leap-shutdown-test-token' }));
  assert.match((await plugin.query(''))[1].description, /^将于 .* 关机（剩余 10 分钟）$/);
  const message = await plugin.selectItem('cancel');
  assert.equal(plugin.calls.execFile[0][0], '/bin/ps');
  assert.equal(Array.from(plugin.calls.execFile[0][1]).join(' '), '-p 900 -o command=');
  assert.deepEqual(plugin.calls.kill, [[-900, 'SIGTERM']]);
  assert.equal(plugin.state(), null);
  assert.match(message, /^已取消定时关机（原定 \d{2}:\d{2}）。$/);
  assert.deepEqual(plugin.calls.notify, [message], '取消成功发一条通知，文案与返回值一致');
  assert.equal(plugin.calls.hide, 1, '取消成功后收起启动器');
});

test('关机取消遇到进程已退出或 token 不符时清理记录但不误杀', async () => {
  for (const ps of [() => null, () => '# 其它进程']) {
    const plugin = load({ ps });
    plugin.seed(JSON.stringify({ pid: 900, fireAt: Date.now() + 600000, minutes: 10, token: 'gone' }));
    assert.match(await plugin.selectItem('cancel'), /已失效，记录已清理/);
    assert.deepEqual(plugin.calls.kill, []);
    assert.equal(plugin.state(), null);
    assert.deepEqual(plugin.calls.notify, ['定时关机已失效，记录已清理。'], '失效记录也收起窗口并提示');
    assert.equal(plugin.calls.hide, 1);
  }
});

test('关机没有定时任务时取消只给出提示，损坏的记录当作没有任务', async () => {
  const plugin = load();
  assert.match(await plugin.select('取消'), /当前没有定时关机任务/);
  assert.equal(plugin.calls.execFile.length, 0);
  assert.equal(plugin.calls.hide, 0, '空操作不收起窗口');
  assert.deepEqual(plugin.calls.notify, [], '空操作不发通知');
  plugin.seed('{ not json');
  assert.equal((await plugin.query(''))[1].description, '当前没有定时关机任务');
  assert.match(await plugin.selectItem('cancel'), /当前没有定时关机任务/);
  assert.equal(plugin.calls.hide, 0);
  assert.deepEqual(plugin.calls.notify, []);
  assert.ok(plugin.calls.logs.some(values => values[0] === '定时关机记录无法解析'));
});

test('关机替换已有安排时先终止旧任务，再写入新记录', async () => {
  const plugin = load({ ps: () => '# old-token' });
  plugin.seed(JSON.stringify({ pid: 900, fireAt: Date.now() + 60000, minutes: 1, token: 'old-token' }));
  await plugin.select('60');
  assert.deepEqual(plugin.calls.kill, [[-900, 'SIGTERM']]);
  const state = plugin.state();
  assert.equal(state.pid, 123);
  assert.equal(state.minutes, 60);
});

test('关机重复回车只启动一次任务', async () => {
  const plugin = load();
  const first = plugin.select('30');
  assert.match(await plugin.select('30'), /正在执行/);
  await first;
  assert.equal(plugin.calls.spawn.length, 1);
});

test('关机启动失败保留窗口、释放句柄并允许重试', async () => {
  const failure = new Error('spawn ENOENT');
  const plugin = load({ spawnError: failure });
  await assert.rejects(plugin.select('30'), /无法启动关机任务.*ENOENT/);
  assert.equal(plugin.calls.close, 1);
  assert.equal(plugin.calls.unref, 0);
  assert.equal(plugin.calls.hide, 0);
  assert.equal(plugin.calls.writeFile.length, 0);
  await assert.rejects(plugin.select('30'), /ENOENT/);
  assert.equal(plugin.calls.spawn.length, 2);
});

test('关机状态写入失败时终止刚启动的任务，避免无法取消的关机', async () => {
  const failure = new Error('EACCES');
  failure.code = 'EACCES';
  const plugin = load({ writeError: failure });
  await assert.rejects(plugin.select('30'), /无法保存定时关机记录.*EACCES/);
  assert.deepEqual(plugin.calls.kill, [[-123, 'SIGTERM']]);
  assert.equal(plugin.calls.hide, 0);
  assert.equal(plugin.calls.close, 1);
});

test('关机读取状态失败或进程查询失败时给出可读错误', async () => {
  const plugin = load({
    files: { async readFile() { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } },
  });
  await assert.rejects(plugin.query(''), /无法读取定时关机记录.*EIO/);

  const fallback = load();
  fallback.seed(JSON.stringify({ pid: 900, fireAt: Date.now() + 60000, minutes: 1, token: 'token' }));
  fallback.calls.execFile = [];
  assert.match(await fallback.selectItem('cancel'), /已失效/);
});

test('关机通知失败不影响已生效的定时任务', async () => {
  const plugin = load({
    leap: { async showNotification() { throw new Error('通知权限未授权'); } },
  });
  await plugin.select('30');
  assert.equal(plugin.state().pid, 123);
  assert.equal(plugin.calls.hide, 1);
  assert.ok(plugin.calls.logs.some(values => values[0] === '关机通知发送失败'));
});
