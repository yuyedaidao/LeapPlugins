'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../plugins/json-formatter');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'format.js'), 'utf8'), sandbox, {
  filename: path.join(root, 'format.js'), timeout: 1000,
});
const { format, minify, parseError } = sandbox.window.JSONFormat;

function loadEntry({ clipboard, pbpasteError } = {}) {
  const calls = { execFile: [], logs: [] };
  const callbacks = {};
  const child = {
    execFile(file, options, callback) {
      calls.execFile.push([file, options]);
      queueMicrotask(() => (pbpasteError ? callback(pbpasteError, '') : callback(null, clipboard ?? '')));
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), {
    leap: {
      onInvoke(callback) { callbacks.invoke = callback; },
      log(...values) { calls.logs.push(values); },
    },
    require(name) {
      return name === 'node:child_process' ? child : require(name);
    },
  }, { filename: path.join(root, 'main.js'), timeout: 1000 });
  return {
    calls,
    invoke: query => callbacks.invoke({ commandID: 'json-format.run', query }),
    raw: context => callbacks.invoke(context),
  };
}

test('格式化保留结构并缩进两个空格', () => {
  assert.equal(format('{"a":1,"b":[1,2]}'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.equal(format('  '), '');
  assert.equal(format('[]'), '[]');
});

test('压缩去掉所有多余空白', () => {
  assert.equal(minify('{ "a" : 1 , "b" : [ 1, 2 ] }'), '{"a":1,"b":[1,2]}');
  assert.equal(minify(''), '');
});

test('非法 JSON 报出可读错误，有位置信息时带行列', () => {
  const withPosition = new Error('Expected property name in JSON at position 4');
  assert.equal(parseError(withPosition, '{\n  a:1}'), '不是合法的 JSON（第 2 行第 3 列）：Expected property name in JSON at position 4');
  // JavaScriptCore 只说原因、不给位置。
  const bare = new Error("JSON Parse error: Expected '}'");
  assert.equal(parseError(bare, '{\n  a:1}'), "不是合法的 JSON：Expected '}'");
  assert.equal(parseError('boom', ''), '不是合法的 JSON：boom');
  assert.throws(() => minify('{a:1}'), /JSON/);
});

test('入口用 pbpaste 返回剪贴板，其他查询当作待格式化文本', async () => {
  const plugin = loadEntry({ clipboard: '{"a":1}' });
  assert.equal(await plugin.invoke('clipboard'), '{"a":1}');
  assert.deepEqual(plugin.calls.execFile.map(([file]) => file), ['/usr/bin/pbpaste']);
  assert.equal(await plugin.invoke('{"a":1,"b":[1,2]}'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  await assert.rejects(plugin.invoke('{a:1}'), /不是合法的 JSON/);
  await assert.rejects(plugin.raw({ commandID: 'other', query: 'clipboard' }), /未知调用/);
});

test('入口的剪贴板读取失败报中文错误', async () => {
  const plugin = loadEntry({ pbpasteError: new Error('denied') });
  await assert.rejects(plugin.invoke('clipboard'), /无法读取剪贴板.*denied/);
});
