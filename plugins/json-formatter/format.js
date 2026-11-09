(function (root) {
'use strict';

// 页面直接加载；测试用 vm 桩 window 或 require 后取 globalThis.JSONFormat。
root.JSONFormat = {
  /** 解析并缩进；非法 JSON 抛错，空文本返回空字符串。 */
  format(text) {
    const value = String(text ?? '');
    if (!value.trim()) return '';
    return JSON.stringify(JSON.parse(value), null, 2);
  },

  /** 压成一行；非法 JSON 抛错，空文本返回空字符串。 */
  minify(text) {
    const value = String(text ?? '');
    if (!value.trim()) return '';
    return JSON.stringify(JSON.parse(value));
  },

  /**
   * 把 JSON.parse 的错误整理成一句中文。
   * WKWebView 的 JavaScriptCore 不报字符位置，只有 Chromium 系引擎的消息带 "at position N"，
   * 所以位置只在有位置信息时附上。
   */
  parseError(error, text) {
    // 跨 realm 的 Error 不是 instanceof Error，只认 message 形状。
    const raw = error && typeof error.message === 'string' ? error.message : String(error);
    const message = raw.replace(/^JSON Parse error: /, '');
    const matched = /position (\d+)/.exec(message);
    if (!matched) return `不是合法的 JSON：${message}`;
    const before = String(text ?? '').slice(0, Number(matched[1]));
    const line = before.split('\n').length;
    const column = Number(matched[1]) - before.lastIndexOf('\n');
    return `不是合法的 JSON（第 ${line} 行第 ${column} 列）：${message}`;
  },
};
})(typeof window === 'undefined' ? globalThis : window);
