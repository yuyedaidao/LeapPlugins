'use strict';

const { execFile } = require('node:child_process');

// 网页没有读剪贴板文本的 API，只能由入口用 pbpaste 读回给页面。
function readClipboard() {
  return new Promise((resolve, reject) => {
    // Leap 的插件进程没有 LANG，pbpaste 会退化成 GBK 输出，必须显式指定 UTF-8。
    execFile('/usr/bin/pbpaste', {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    }, (error, stdout) => {
      if (error) reject(new Error(`无法读取剪贴板：${error.message}`));
      else resolve(stdout);
    });
  });
}

leap.onInvoke(({ commandID, query }) => {
  if (commandID !== 'json-format.run') return Promise.reject(new Error('未知调用。'));
  if (query === 'clipboard') return readClipboard();
  // 兜底：其他 query 当成待格式化文本，方便命令行确认入口可用。
  try {
    return Promise.resolve(JSON.stringify(JSON.parse(String(query ?? '')), null, 2));
  } catch (error) {
    return Promise.reject(new Error(`不是合法的 JSON：${error.message}`));
  }
});
