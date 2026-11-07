#!/usr/bin/env node
/**
 * build-apk.mjs — بناء ملف تطبيق الأندرويد (wasla-app.apk) بضغطة واحدة
 *
 * الاستخدام:
 *   npm run apk
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, '..');
const ROOT_DIR = resolve(FRONTEND_DIR, '..');
const ANDROID_DIR = resolve(FRONTEND_DIR, 'android');

console.log('\n[1/3] بناء حزمة الواجهة الأمامية (Vite Production Build)...');
execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });

console.log('\n[2/3] مزامنة الملفات مع مشروع الأندرويد (Capacitor Sync)...');
execSync('npx cap sync android', { cwd: FRONTEND_DIR, stdio: 'inherit' });

console.log('\n[3/3] تجميع ملف الـ APK عبر Gradle...');
const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug';
execSync(gradleCmd, { cwd: ANDROID_DIR, stdio: 'inherit' });

const builtApk = resolve(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const targetApk = resolve(ROOT_DIR, 'wasla-app.apk');

if (existsSync(builtApk)) {
  copyFileSync(builtApk, targetApk);
  console.log(`\nتم بناء ملف التطبيق بنجاح: ${targetApk}`);
} else {
  console.error('\nلم يتم العثور على ملف الـ APK الناتج.');
  process.exit(1);
}
