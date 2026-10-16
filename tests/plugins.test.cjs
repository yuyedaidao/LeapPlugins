'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plugins = path.resolve(__dirname, '../plugins');

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
