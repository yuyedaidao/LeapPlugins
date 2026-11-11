'use strict';
// 从 plugins/*/manifest.json 生成 store.json：索引是生成物，不手写，避免与清单漂移。
// 用法：node Scripts/build-index.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugins = path.join(root, 'plugins');
const output = path.join(root, 'store.json');
const storeName = 'Leap 官方插件';

function summaryOf(directory, manifest) {
  const readme = path.join(plugins, directory, 'README.md');
  if (!fs.existsSync(readme)) return undefined;
  const paragraphs = fs
    .readFileSync(readme, 'utf8')
    .split(/\n\s*\n/)
    // 首个段落之后才是正文，标题行单独成段时跳过。
    .map(paragraph => paragraph.replace(/^#.*$/gm, '').trim())
    .filter(Boolean);
  const text = (paragraphs[0] || '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  // 首段常以「最低要求/适用于」开头，那不是插件简介，先剥掉这些句子。
  const description = text.replace(/^(最低要求|需要|适用于)[^。！？]*[。！？]\s*/, '').trim();
  // 只取首句，列表里保持一行。
  const sentence = (description || text).split(/(?<=[。！？])|(?<=[.!?])\s+/)[0];
  return sentence.length <= 80 ? sentence : `${sentence.slice(0, 79)}…`;
}

function build() {
  const directories = fs
    .readdirSync(plugins, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
  const entries = directories.map(directory => {
    const manifest = JSON.parse(fs.readFileSync(path.join(plugins, directory, 'manifest.json'), 'utf8'));
    const entry = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      path: `plugins/${directory}`,
      commands: manifest.commands.map(command => command.title),
    };
    const summary = summaryOf(directory, manifest);
    if (summary) entry.summary = summary;
    if (manifest.icon) entry.icon = manifest.icon;
    if (manifest.runtime) entry.runtime = manifest.runtime;
    if (manifest.minimumHostVersion) entry.minimumHostVersion = manifest.minimumHostVersion;
    return entry;
  });
  return { schemaVersion: 1, name: storeName, plugins: entries };
}

const json = `${JSON.stringify(build(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  if (current !== json) {
    console.error('store.json 与插件清单不一致，请运行 node Scripts/build-index.mjs');
    process.exit(1);
  }
} else {
  fs.writeFileSync(output, json);
  console.log(`已生成 store.json：${build().plugins.length} 个插件。`);
}
