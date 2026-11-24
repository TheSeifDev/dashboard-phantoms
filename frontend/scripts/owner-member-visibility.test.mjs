import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { createRequire, Module } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(frontend, 'package.json'));
const tooling = process.env.PHANTOMS_AUTH_TEST_TOOLING ? createRequire(join(process.env.PHANTOMS_AUTH_TEST_TOOLING, 'package.json')) : require;
const { JSDOM } = tooling('jsdom');
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/admin/members/experience', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => { throw new Error('Preview must not fetch'); };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { MemoryRouter } = require('react-router-dom');
const ts = require('typescript');
const el = React.createElement;
let lang = 'en', root, mediaReverts = 0;
const mocks = {
  'i18n/useLocale.ts': { useLocale: () => ({ t: (ar, en) => lang === 'ar' ? ar : en, dir: lang === 'ar' ? 'rtl' : 'ltr' }) },
  'components/ui/Button.tsx': { Button: ({ variant: _variant, icon: _icon, children, ...props }) => el('button', props, children) },
  'features/members/customFieldsApi.ts': { formatCustomFieldValue: (_, v) => String(v ?? ''), getMemberCustomFieldValue: (m, f) => m.custom_fields?.[f.id] },
  'features/members/MemberCells.tsx': { DeviceChips: () => null, ReadinessChip: () => null, WorkStatusChip: () => null },
  'features/dashboard/github.ts': { githubAvatarUrl: (handle, size = 64) => `https://github.com/${handle}.png?size=${size}`, resolveGithubHandle: () => null },
  'features/dashboard/GithubMark.tsx': { GithubMark: () => null },
  'features/members/OwnerMemberErasure.tsx': { OwnerMemberErasure: ({ isOwner }) => isOwner ? el('button', { 'data-testid': 'owner-erasure-preview' }, 'Owner erasure preview') : null },
};
const actual = new Set(['features/members/profile-fields.ts', 'features/members/member-profile-display.ts', 'features/members/MemberAcademicDetails.tsx', 'features/members/MissingProfileFields.tsx', 'features/members/MemberCards.tsx', 'features/members/MemberProfileFields.tsx', 'features/members/MemberExperiencePreviewPage.tsx', 'features/app-usage/MemberAppUsageDetails.tsx', 'components/ui/MemberAvatar.tsx']);
const modules = new Map();
function load(path) {
  const base = resolve(frontend, 'src', path);
  const file = [base, base + '.ts', base + '.tsx'].find(existsSync) ?? base;
  const key = relative(join(frontend, 'src'), file);
  if (mocks[key]) return mocks[key];
  if (modules.has(file)) return modules.get(file).exports;
  assert.ok(actual.has(key), 'Unexpected module or possible session/transport dependency: ' + key);
  const m = new Module(file); modules.set(file, m); m.filename = file;
  m.require = (name) => {
    if (name.endsWith('.css')) return {};
    if (name.startsWith('.')) return load(resolve(dirname(file), name));
    if (name === 'gsap') return { gsap: { matchMedia: () => ({ add: () => {}, revert: () => mediaReverts++ }), from: () => {} } };
    return require(name);
  };
  m._compile(ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
const Preview = load('features/members/MemberExperiencePreviewPage.tsx').default;
const { MemberCards } = load('features/members/MemberCards.tsx');
const display = load('features/members/member-profile-display.ts');
const member = { id: 42, full_name: 'Demo', email: 'demo@example.com', phone: '+201000000000', bio: 'specialization: LEGACY BIO', residence: 'Cairo', work_conditions: 'Remote', device: 'لابتوب', gender: 'ذكر', academic_number: '003001', academic_group: 'G-1', specialization: 'ai', university_email: '003001@batechu.com', linkedin_url: 'https://www.linkedin.com/in/demo', portfolio_url: 'https://example.com/portfolio', custom_fields: {} };
async function mount(node, language = 'en') {
  lang = language; localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('owner-sentinel', 'untouched'); sessionStorage.setItem('member-sentinel', 'untouched');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(el(MemoryRouter, null, node)));
}
async function unmount() { if (root) await act(async () => root.unmount()); root = null; }
const text = () => document.body.textContent;
const query = (id) => document.getElementById(id);
async function change(id, value) {
  const node = query(id); assert.ok(node, id);
  const prototype = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value); node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function submit() { await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
afterEach(unmount); after(() => dom.window.close());

test('canonical academic fields/search/completeness ignore legacy bio and optional legacy data', () => {
  assert.equal(display.memberSpecializationLabel('ai'), 'AI');
  assert.equal(display.memberSpecializationLabel(null), '');
  assert.equal(display.hasRequiredMemberInformation(member), true);
  assert.equal(display.hasRequiredMemberInformation({ ...member, device: 'legacy unknown' }), false);
  assert.deepEqual(display.missingMemberProfileFields({ ...member, device: 'legacy unknown' }), ['device']);
  for (const key of ['academic_number', 'academic_group', 'specialization', 'university_email', 'phone', 'residence', 'work_conditions', 'bio', 'device', 'gender', 'linkedin_url', 'portfolio_url']) assert.equal(display.hasRequiredMemberInformation({ ...member, [key]: null }), false, key);
  for (const term of ['003001', 'g-1', '003001@batechu.com', 'ai', 'portfolio']) assert.ok(display.memberSearchText(member).includes(term));
});
test('professional links reject script/data/http/private URLs and wrong LinkedIn host', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,evil', 'http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://example.com/#secret', 'https://user:pass@example.com']) assert.equal(display.safeMemberProfessionalLink(value, 'portfolio'), null);
  assert.equal(display.safeMemberProfessionalLink('https://evil.example', 'linkedin'), null);
  assert.equal(display.safeMemberProfessionalLink(member.linkedin_url, 'linkedin'), member.linkedin_url);
});
test('real card shows canonical specialization, academics, completion and safe link attributes', async () => {
  await mount(el(MemberCards, { members: [member], onView: () => {}, onEdit: () => {}, onDelete: () => {} }));
  for (const value of ['AI', '003001', 'G-1', '003001@batechu.com', 'Required information complete']) assert.ok(text().includes(value), value);
  assert.ok(!text().includes('LEGACY BIO'));
  assert.equal(document.querySelector('a').rel, 'noopener noreferrer');
});
test('permanent owner action is collapsed by default and never shown without confirmed owner access', async () => {
  await mount(el(MemberCards, { members: [member], isOwner: false, onView: () => {}, onEdit: () => {}, onDelete: () => {} }));
  assert.equal(document.querySelector('details'), null);
  assert.equal(document.querySelector('[data-testid="owner-erasure-preview"]'), null);

  await unmount();
  await mount(el(MemberCards, { members: [member], isOwner: true, onView: () => {}, onEdit: () => {}, onDelete: () => {} }));
  const details = document.querySelector('details');
  assert.ok(details);
  assert.equal(details.open, false);
  assert.ok(details.querySelector('summary')?.textContent?.includes('Advanced owner action'));
  assert.ok(details.querySelector('[data-testid="owner-erasure-preview"]'));
});
test('incomplete Arabic card explicitly asks for information rather than guessing specialization', async () => {
  await mount(el(MemberCards, { members: [{ ...member, academic_number: null, specialization: null }], onView: () => {}, onEdit: () => {}, onDelete: () => {} }), 'ar');
  assert.ok(text().includes('يلزم استكمال البيانات')); assert.ok(text().includes('التخصص مش محدد')); assert.ok(!text().includes('LEGACY BIO'));
});
test('preview requires core fields, keeps emails read-only and validates without session/transport imports', async () => {
  await mount(el(Preview));
  assert.ok(text().includes('Demo preview only'));
  for (const suffix of ['full-name', 'phone', 'academic-number', 'academic-group', 'specialization']) assert.equal(query('preview-' + suffix).required, true);
  assert.equal(query('preview-email').readOnly, true); assert.equal(query('preview-university-email').readOnly, true);
  assert.equal(query('preview-linkedin-url').required, true);
  await submit(); assert.equal(query('preview-residence').getAttribute('aria-invalid'), 'true'); assert.equal(document.activeElement.id, 'preview-residence');
  await change('preview-academic-number', '٠٠۳۰۰۱'); await change('preview-academic-group', 'G-1'); await change('preview-specialization', 'ai');
  for (const [suffix, value] of [['residence', 'Cairo'], ['device', 'لابتوب'], ['gender', 'ذكر'], ['work-conditions', 'Remote'], ['bio', 'Frontend member'], ['linkedin-url', 'https://www.linkedin.com/in/demo'], ['portfolio-url', 'https://github.com/demo']]) await change('preview-' + suffix, value);
  assert.equal(query('preview-university-email').value, '003001@batechu.com');
  await submit(); assert.ok(text().includes('Preview validation passed')); assert.ok(text().includes('No real member was saved'));
  assert.equal(localStorage.getItem('owner-sentinel'), 'untouched'); assert.equal(localStorage.length, 1); assert.equal(sessionStorage.length, 1);
});
test('preview rejects unsafe optional links and supports Arabic example reset and motion cleanup', async () => {
  const before = mediaReverts;
  await mount(el(Preview), 'ar');
  assert.equal(document.querySelector('section').dir, 'rtl');
  const complete = [...document.querySelectorAll('button')].find((b) => b.textContent === 'مثال بيانات مكتملة');
  await act(async () => complete.click()); await change('preview-portfolio-url', 'javascript:evil'); await submit();
  assert.equal(query('preview-portfolio-url').getAttribute('aria-invalid'), 'true');
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'مثال بيانات ناقصة').click());
  assert.equal(query('preview-academic-number').value, ''); assert.ok(!document.querySelector('[role="alert"]'));
  const paths = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  for (const path of ['/login', '/portal/settings', '/forgot-password']) assert.ok(paths.includes(path));
  await unmount(); assert.equal(mediaReverts, before + 1);
});
test('preview is guarded and declared, never bypasses protected member Settings', () => {
  const router = readFileSync(join(frontend, 'src/router/index.tsx'), 'utf8');
  assert.match(router, /path: 'members\/experience', element: <AdminSection permission="members">/);
  // الإعدادات بقت child جوه /portal عشان تاخد نفس السايدبار والهيدر، والحماية
  // بتيجي من مسار الأب (ProtectedMemberRoute) — مفيش مسار منفصل بيعدي الحماية.
  assert.match(router, /path: '\/portal',\s*element: <ProtectedMemberRoute>/);
  assert.match(router, /\{ path: 'settings', element: <Page><MemberSettingsPage \/>/);
  assert.doesNotMatch(router, /path: '\/portal\/settings'/);
  assert.ok(JSON.parse(readFileSync(join(frontend, 'public/manus-routes.json'))).routes.some((r) => r.path === '/admin/members/experience'));
});
