import assert from "node:assert/strict";
import test from "node:test";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

// IntlProvider.formatMessage 只做 {key} 替换，不解析 ICU plural/select，
// 带这类语法的文案会把模板原样显示给用户。
test("locale messages do not use ICU plural or select syntax", () => {
  for (const [name, messages] of [
    ["en-US", enUS],
    ["zh-CN", zhCN],
  ] as const) {
    const offenders = Object.entries(messages)
      .filter(([, value]) => /\{\s*\w+\s*,\s*(plural|select|selectordinal)\b/.test(value))
      .map(([key]) => key);
    assert.deepEqual(offenders, [], `${name} has unsupported ICU messages`);
  }
});
