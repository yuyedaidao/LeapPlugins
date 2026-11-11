'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const store = JSON.parse(fs.readFileSync(path.join(root, 'store.json'), 'utf8'));

test('store.json 与插件清单一致（索引是生成物）', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'Scripts/build-index.mjs'), '--check'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || '请运行 node Scripts/build-index.mjs 重新生成索引');
});

test('每条索引都能定位到已发布插件目录与清单', () => {
  const ids = new Set();
  assert.equal(store.schemaVersion, 1);
  assert.ok(store.plugins.length > 0);
  for (const entry of store.plugins) {
    const directory = path.join(root, entry.path);
    assert.ok(directory.startsWith(path.join(root, 'plugins') + path.sep), '插件目录必须位于 plugins/');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assert.equal(entry.id, manifest.id);
    assert.equal(entry.name, manifest.name);
    assert.equal(entry.version, manifest.version);
    assert.deepEqual(entry.commands, manifest.commands.map(command => command.title));
    assert.ok(!ids.has(entry.id), `插件 ID 重复：${entry.id}`);
    ids.add(entry.id);
    // 内置插件 ID 由 Leap 随包提供，商店不得提供同名条目。
    assert.ok(!['com.padding.leap.template-generator', 'com.padding.leap.clipboard'].includes(entry.id));
    if (manifest.minimumHostVersion) assert.equal(entry.minimumHostVersion, manifest.minimumHostVersion);
    // 图标是清单里的相对路径，App 侧据此拼 raw URL 远程加载。
    assert.equal(entry.icon, manifest.icon);
    if (entry.icon) assert.ok(fs.existsSync(path.join(directory, entry.icon)), `图标缺失：${entry.id}`);
  }
});

test('每条索引都有可直接展示的单行简介', () => {
  for (const entry of store.plugins) {
    assert.ok(entry.summary, `缺少简介：${entry.id}`);
    assert.ok(!entry.summary.includes('\n'), `简介必须是单行：${entry.id}`);
    assert.ok(entry.summary.length <= 80, `简介过长：${entry.id}`);
  }
});
