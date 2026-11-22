import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IOS_INSTALL_STEPS,
  detectInstallPlatform,
  isIOSDevice,
  isIOSSafari,
  isIOSStandalone,
} from '../src/features/app-download/ios-install';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

test('isIOSDevice: بيعرف iPhone و iPad و iPadOS الحديث', () => {
  assert.equal(isIOSDevice({ userAgent: IPHONE_SAFARI }), true);
  assert.equal(isIOSDevice({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIOSDevice({ userAgent: ANDROID_UA }), false);
  assert.equal(isIOSDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }), false);
});

test('isIOSSafari: بيفرّق Safari عن Chrome على iOS', () => {
  assert.equal(isIOSSafari({ userAgent: IPHONE_SAFARI }), true);
  assert.equal(isIOSSafari({ userAgent: IPHONE_CHROME }), false);
  assert.equal(isIOSSafari({ userAgent: ANDROID_UA }), false);
});

test('isIOSStandalone: بيحترم العلم الصريح', () => {
  assert.equal(isIOSStandalone({ standalone: true }), true);
  assert.equal(isIOSStandalone({ standalone: false }), false);
});

test('detectInstallPlatform: بيختار المنصة الصح', () => {
  assert.equal(detectInstallPlatform({ userAgent: IPHONE_SAFARI }), 'ios');
  assert.equal(detectInstallPlatform({ userAgent: ANDROID_UA }), 'android');
  assert.equal(detectInstallPlatform({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }), 'desktop');
  assert.equal(detectInstallPlatform({ userAgent: IPHONE_SAFARI, native: true }), 'desktop');
});

test('IOS_INSTALL_STEPS: 3 خطوات وفيها "إضافة إلى الشاشة الرئيسية"', () => {
  assert.equal(IOS_INSTALL_STEPS.length, 3);
  const text = IOS_INSTALL_STEPS.map((step) => `${step.title.ar} ${step.body.ar}`).join(' ');
  assert.match(text, /Safari/);
  assert.match(text, /إضافة إلى الشاشة الرئيسية/);
  assert.match(text, /مشاركة/);
  for (const step of IOS_INSTALL_STEPS) {
    assert.ok(step.title.en.length > 0);
    assert.ok(step.body.en.length > 0);
  }
});
