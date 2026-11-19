const { test } = require('node:test');
const assert = require('node:assert/strict');

const locales = require('./load-typescript.cjs')('src/lib/i18n/locales.ts');
const dictionaries = require('./load-typescript.cjs')('src/lib/i18n/messages.ts');

test('system preference follows the system locale', () => {
  assert.equal(locales.resolveLocale('system', 'zh-CN'), 'zh-CN');
  assert.equal(locales.resolveLocale('system', 'en-US'), 'en-US');
  assert.equal(locales.resolveLocale('zh-CN', 'en-US'), 'zh-CN');
  assert.equal(locales.resolveLocale('en-US', 'zh-CN'), 'en-US');
});

test('language tags are normalized for every supported region', () => {
  assert.equal(locales.localeFromLanguageTag('zh'), 'zh-CN');
  assert.equal(locales.localeFromLanguageTag('zh-CN'), 'zh-CN');
  assert.equal(locales.localeFromLanguageTag('zh-TW'), 'zh-CN');
  assert.equal(locales.localeFromLanguageTag('zh-Hans'), 'zh-CN');
  assert.equal(locales.localeFromLanguageTag('en'), 'en-US');
  assert.equal(locales.localeFromLanguageTag('en-GB'), 'en-US');
  assert.equal(locales.localeFromLanguageTag('ja-JP'), 'en-US');
  assert.equal(locales.localeFromLanguageTag(''), 'en-US');
  assert.equal(locales.localeFromLanguageTag(null), 'en-US');
});

test('only supported preferences and locales pass validation', () => {
  assert.equal(locales.isLanguagePreference('system'), true);
  assert.equal(locales.isLanguagePreference('zh-CN'), true);
  assert.equal(locales.isLanguagePreference('en-US'), true);
  assert.equal(locales.isLanguagePreference('ja-JP'), false);
  assert.equal(locales.isLocale('zh-CN'), true);
  assert.equal(locales.isLocale('system'), false);
});

test('formatMessage interpolates named parameters only', () => {
  assert.equal(locales.formatMessage('每 {gap} 分钟'), '每 {gap} 分钟');
  assert.equal(
    locales.formatMessage('每 {gap} 分钟', { gap: 30 }),
    '每 30 分钟'
  );
  assert.equal(
    locales.formatMessage('{done}/{total} 杯', { done: 3, total: 8 }),
    '3/8 杯'
  );
  assert.equal(locales.formatMessage('{missing}', {}), '{missing}');
});

test('english dictionary covers every chinese key and vice versa', () => {
  const zhKeys = Object.keys(dictionaries.zhCN).sort();
  const enKeys = Object.keys(dictionaries.enUS).sort();
  assert.deepEqual(enKeys, zhKeys);
});

test('no dictionary entry is empty', () => {
  for (const [locale, dict] of Object.entries(dictionaries.messages)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(
        value.trim().length > 0,
        true,
        `${locale} has an empty message for ${key}`
      );
    }
  }
});

test('english copy does not keep chinese-only sentences', () => {
  const chineseOnly = Object.entries(dictionaries.enUS).filter(
    ([, value]) => /[\u4e00-\u9fa5]/.test(value)
  );
  // 「中文」是语言选项自身的名字，允许保留。
  assert.deepEqual(
    chineseOnly.map(([key]) => key),
    ['language.zh']
  );
});
