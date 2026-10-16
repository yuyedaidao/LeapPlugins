'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plugins = path.resolve(__dirname, '../plugins');

function load(name, copyText = async () => true) {
  const callbacks = {};
  let items = [];
  let metadata;
  const leap = {
    onInputChange(callback) { callbacks.input = callback; },
    onSelect(callback) { callbacks.select = callback; },
    copyText,
  };
  // 用宿主接口的最小替身测试业务，不依赖 Leap 内部 SDK 或真实剪贴板。
  const entry = path.join(plugins, name, 'main.js');
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), { leap }, { filename: entry, timeout: 1000 });
  return {
    query(text) {
      callbacks.input({ text, setList(value, options) { items = value; metadata = options; } });
      return { items: JSON.parse(JSON.stringify(items)), metadata };
    },
    select(index) {
      assert.ok(items[index], '测试只能选择当前列表中存在的条目');
      return callbacks.select({ item: items[index] });
    },
  };
}

test('每个目录是具有唯一 ID 和有效入口的自包含插件', () => {
  const ids = new Set();
  const directories = fs.readdirSync(plugins, { withFileTypes: true });
  assert.ok(directories.length > 0);
  for (const directory of directories) {
    assert.ok(directory.isDirectory());
    const root = path.join(plugins, directory.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.match(manifest.id, /^[a-zA-Z0-9._-]+$/);
    assert.ok(!ids.has(manifest.id), '插件 ID 不得重复');
    ids.add(manifest.id);
    assert.equal(manifest.runtime, 'javascript');
    assert.equal(manifest.minimumHostVersion, '1.2.0');
    assert.ok(manifest.commands.length > 0);
    const entry = path.resolve(root, manifest.entry);
    assert.ok(entry.startsWith(root + path.sep), '入口不得引用兄弟目录');
    assert.ok(fs.statSync(entry).isFile());
    if (manifest.icon) {
      const icon = path.resolve(root, manifest.icon);
      assert.ok(icon.startsWith(root + path.sep), '图标不得引用插件目录之外的资源');
      assert.match(path.extname(icon), /^\.(png|jpe?g|icns)$/i);
      assert.ok(fs.statSync(icon).isFile());
    }
    for (const file of fs.readdirSync(root)) {
      assert.ok(!fs.lstatSync(path.join(root, file)).isSymbolicLink());
    }
  }
});

test('文本转换处理大小写、中文和空输入', () => {
  const plugin = load('text-convert');
  assert.deepEqual(plugin.query('Leap你好').items.map(item => item.title), ['LEAP你好', 'leap你好']);
  assert.equal(plugin.select(0), 'LEAP你好');
  assert.deepEqual(plugin.query('').items, []);
});

test('数字枚举支持前导零、空白和长整数，并拒绝非法输入', () => {
  const plugin = load('number-enumeration');
  for (const [input, expected] of [['123', 6], [' 0012 ', 3], ['19', 0], ['', 0], ['9'.repeat(1000), 0]]) {
    const result = plugin.query(input);
    assert.equal(result.items.length, expected);
    assert.equal(result.metadata.title, `共${expected}个结果`);
  }
  for (const input of ['-1', '1.2', '12a', '１２３', '1'.repeat(1001)]) {
    assert.throws(() => plugin.query(input), /非负整数/);
  }
});

test('数字枚举仅在复制成功后返回成功提示，复制失败可重试', async () => {
  const copies = [];
  let fail = false;
  const plugin = load('number-enumeration', async text => {
    if (fail) throw new Error('复制失败');
    copies.push(text);
    return true;
  });
  plugin.query('123');
  assert.equal(await plugin.select(5), '已复制：标题 5');
  assert.deepEqual(copies, ['标题 5']);
  fail = true;
  await assert.rejects(plugin.select(0), /复制失败/);
  fail = false;
  assert.equal(await plugin.select(0), '已复制：标题 0');
});
