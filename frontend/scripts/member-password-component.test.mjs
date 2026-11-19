import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mounted/mocked only: this harness never talks to Auth, PostgREST, Edge Functions, or a real DB.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontendRoot = join(repositoryRoot, 'frontend');
const frontendRequire = createRequire(join(frontendRoot, 'package.json'));
const toolingRoot = process.env.PHANTOMS_AUTH_TEST_TOOLING;
const toolingRequire = toolingRoot ? createRequire(join(toolingRoot, 'package.json')) : frontendRequire;
const { JSDOM } = toolingRequire('jsdom');
const typescript = frontendRequire('typescript');
const React = frontendRequire('react');
const ReactDOMClient = frontendRequire('react-dom/client');
const Router = frontendRequire('react-router-dom');
const { act } = React;
const { MemoryRouter, Route, Routes, useLocation, useNavigate } = Router;

const loginPath = join(frontendRoot, 'src/features/auth/LoginPage.tsx');
const joinPath = join(frontendRoot, 'src/features/members/MemberSelfRegisterPage.tsx');
const compilerOptions = {
  target: typescript.ScriptTarget.ES2022,
  module: typescript.ModuleKind.CommonJS,
  jsx: typescript.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
};

const EMAIL = 'member@example.test';
const OTHER_EMAIL = 'other@example.test';
const TOKEN = 'phpw_' + 'a'.repeat(64);
const PASSWORD = 'CorrectHorse9!';
const WEAK_PASSWORD = 'short';
const AUTH_UID = 'auth-member-7';
const OTHER_UID = 'auth-other-8';
const MEMBER = {
  id: 7,
  email: EMAIL,
  full_name: 'Synthetic Member',
  auth_user_id: AUTH_UID,
  work_status: 'active',
  session_token: null,
};
const OTHER_MEMBER = {
  ...MEMBER,
  id: 8,
  email: OTHER_EMAIL,
  auth_user_id: OTHER_UID,
  full_name: 'Other Synthetic Member',
};

function compileCommonJs(source, fileName) {
  return typescript.transpileModule(source, { compilerOptions, fileName }).outputText;
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function resolveSourcePath(basePath) {
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, join(basePath, 'index.ts'), join(basePath, 'index.tsx')];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

function isPasswordImplementation(path, source = '') {
  const name = path.toLowerCase();
  return name === loginPath.toLowerCase()
    || name === joinPath.toLowerCase()
    || name.endsWith('i18n/uselocale.ts')
    || name.includes('member-password')
    || name.includes('password-access')
    || name.endsWith('memberaccessguard.tsx')
    || name.endsWith('memberinviteapi.ts')
    || source.includes('get_member_password_access')
    || source.includes('member-password-enrollment');
}

function relativeSourceSpecifier(source) {
  const found = [];
  const pattern = /(?:from\s*|require\s*\()(['"])(\.\.?\/[^'"]+)\1/g;
  let match;
  while ((match = pattern.exec(source))) found.push(match[2]);
  return [...new Set(found)];
}

async function writeMockFor(harnessRoot, sourcePath) {
  const rel = relative(join(frontendRoot, 'src'), sourcePath).replace(/\\/g, '/');
  const out = join(harnessRoot, 'src', rel).replace(/\.(tsx?|mts|cts)$/, '.js');
  await mkdir(dirname(out), { recursive: true });
  const normalized = rel.replace(/\\/g, '/');
  let body = 'module.exports = {};\n';
  if (normalized.endsWith('components/layout/AuthShell.tsx')) {
    body = `const React = require('react');
exports.AuthShell = function AuthShell({ title, description, children, footer }) {
  return React.createElement('section', { 'data-auth-shell': 'true' },
    React.createElement('h1', null, title), React.createElement('p', null, description), children, footer);
};\n`;
  } else if (normalized.endsWith('components/motion/PhantomLoader.tsx')) {
    body = `const React = require('react');
exports.PhantomLoader = function PhantomLoader({ label, message, children }) {
  return React.createElement('div', { role: 'status' }, label || message || children || 'جارٍ التحميل');
};\n`;
  } else if (normalized.endsWith('lib/validators.ts')) {
    body = `exports.isValidEmail = (value) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);\n`;
  } else if (normalized.endsWith('lib/supabase/member-client.ts')) {
    body = `const forward = (path) => (...args) => path().apply(null, args);
exports.memberSupabase = {
  auth: {
    signInWithPassword: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.signInWithPassword),
    getSession: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.getSession),
    getUser: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.getUser),
    onAuthStateChange: (...args) => globalThis.__PASSWORD_TEST.memberSupabase.auth.onAuthStateChange(...args),
    signOut: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.signOut),
    signUp: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.signUp),
    signInWithOtp: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.signInWithOtp),
    verifyOtp: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.auth.verifyOtp),
  },
  rpc: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.rpc),
  functions: { invoke: forward(() => globalThis.__PASSWORD_TEST.memberSupabase.functions.invoke) },
};\n`;
  } else if (normalized.endsWith('store/auth.ts')) {
    body = `const React = require('react');
		let state;
		let deviceToken = null;
		const listeners = new Set();
function emit() { listeners.forEach((listener) => listener()); }
function useAuthStore(selector) {
  return selector(React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state));
}
useAuthStore.getState = () => state;
exports.useAuthStore = useAuthStore;
exports.getState = () => state;
exports.getMemberRemember = () => globalThis.__PASSWORD_TEST.remember;
exports.setMemberRemember = (remember) => {
  globalThis.__PASSWORD_TEST.rememberCalls.push(remember);
  const result = globalThis.__PASSWORD_TEST.rememberTransition;
  if (!result.ok) return result;
  globalThis.__PASSWORD_TEST.remember = remember;
  try { localStorage.setItem('phantoms_member_remember', remember ? '1' : '0'); } catch {}
  return result;
};
exports.setDeviceToken = (token, remember) => {
  globalThis.__PASSWORD_TEST.deviceCalls.push({ token, remember });
  deviceToken = token;
  try { (remember ? localStorage : sessionStorage).setItem('phantoms_device_token', token); } catch {}
};
exports.getDeviceToken = () => deviceToken;
exports.clearDeviceToken = () => {
  deviceToken = null;
  try { localStorage.removeItem('phantoms_device_token'); } catch {}
  try { sessionStorage.removeItem('phantoms_device_token'); } catch {}
};
		exports.__setMember = (member, remember) => {
	  globalThis.__PASSWORD_TEST.setMemberCalls.push({ member, remember });
	  state = { ...state, currentMember: member, setMember: exports.__setMember, logoutMember: exports.logoutMember };
  try { (remember ? localStorage : sessionStorage).setItem('phantoms_member_session', JSON.stringify({ ...member, session_token: null })); } catch {}
  emit();
};
		exports.__resetStore = () => { deviceToken = null; state = { currentMember: null, user: null, session: null, ready: true, setMember: exports.__setMember, logoutMember: exports.logoutMember }; emit(); };
exports.__setMemberForComponent = (member, remember) => exports.__setMember(member, remember);
exports.logoutMember = () => { state = { ...state, currentMember: null }; emit(); };
// The component normally calls the hook-returned setMember; expose it through state as well.
	state = { currentMember: null, user: null, session: null, ready: true, setMember: exports.__setMember, logoutMember: exports.logoutMember };
`;
  } else if (normalized.endsWith('features/members/api.ts')) {
    body = `exports.bindMemberDeviceSession = (...args) => globalThis.__PASSWORD_TEST.bindMemberDeviceSession(...args);
exports.fetchMemberByEmail = (...args) => globalThis.__PASSWORD_TEST.fetchMemberByEmail(...args);
exports.getMemberPasswordAccess = (...args) => globalThis.__PASSWORD_TEST.getMemberPasswordAccess(...args);
`;
  } else if (normalized.endsWith('features/auth/auth-flow.ts')) {
    body = `exports.normalizeAuthEmail = (value) => String(value ?? '').trim().toLowerCase();
exports.safeMemberAuthError = () => 'تعذر إكمال العملية.';
`;
  } else if (normalized.endsWith('lib/supabase/errors.ts')) {
    body = `exports.toAppError = (error, fallback) => new Error(fallback);\n`;
  } else if (normalized.endsWith('features/members/memberInviteApi.ts')) {
    body = `exports.fetchMemberInviteContext = (...args) => globalThis.__PASSWORD_TEST.fetchMemberInviteContext(...args);
exports.submitMemberRegistrationInvite = (...args) => globalThis.__PASSWORD_TEST.submitMemberRegistrationInvite(...args);
`;
  }
  await writeFile(out, body);
}

async function compileActualTree(harnessRoot, sourcePath, seen = new Set()) {
  const absolute = resolve(sourcePath);
  if (seen.has(absolute)) return;
  seen.add(absolute);
  const source = await readFile(absolute, 'utf8');
  const rel = relative(join(frontendRoot, 'src'), absolute).replace(/\\/g, '/');
  const out = join(harnessRoot, 'src', rel).replace(/\.(tsx?|mts|cts)$/, '.js');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, compileCommonJs(source, absolute));
  for (const specifier of relativeSourceSpecifier(source)) {
    const dependency = await resolveSourcePath(join(dirname(absolute), specifier));
    if (!dependency) continue;
    const dependencySource = await readFile(dependency, 'utf8');
    if (isPasswordImplementation(dependency, dependencySource)) {
      await compileActualTree(harnessRoot, dependency, seen);
    } else {
      await writeMockFor(harnessRoot, dependency);
    }
  }
}

async function writeHarnessFiles(harnessRoot) {
  await mkdir(join(harnessRoot, 'src'), { recursive: true });
  await compileActualTree(harnessRoot, loginPath);
  await compileActualTree(harnessRoot, joinPath);
  // A target module imported through a path not visible in the first pass is still compiled when present.
  const targetCandidates = [
    'src/features/auth/member-password.ts',
    'src/features/auth/member-password-api.ts',
    'src/features/auth/member-password-access.ts',
    'src/features/auth/MemberAccessGuard.tsx',
    'src/features/members/memberInviteApi.ts',
  ];
  for (const candidate of targetCandidates) {
    const path = join(frontendRoot, candidate);
    if (await exists(path)) await compileActualTree(harnessRoot, path);
  }
  await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/login',
    pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'MutationObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'HTMLInputElement']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

function makeControl() {
  const control = {
    remember: true,
    rememberTransition: { ok: true, migrated: false, requiresReauthentication: false },
    authUser: { id: AUTH_UID, email: EMAIL },
    authListeners: new Set(),
    access: { member_id: 7, email: EMAIL, auth_user_id: AUTH_UID, active: true, password_ready: true },
    pendingReview: false,
    membership: 'pending_review',
    profile: MEMBER,
    signInCalls: [],
    getUserCalls: [],
    signOutCalls: [],
    rpcCalls: [],
    invokeCalls: [],
    bindCalls: [],
    fetchCalls: [],
    accessCalls: [],
    rememberCalls: [],
    deviceCalls: [],
    setMemberCalls: [],
    events: [],
    signInWithPassword: async (args) => { control.events.push('auth.signInWithPassword'); control.signInCalls.push(args); return { data: { user: control.authUser }, error: null }; },
    getSession: async () => {
      control.events.push('auth.getSession');
      return { data: { session: control.authUser ? { user: control.authUser } : null }, error: null };
    },
    getUser: async () => { control.events.push('auth.getUser'); control.getUserCalls.push({}); return { data: { user: control.authUser }, error: null }; },
    onAuthStateChange: (callback) => {
      control.authListeners.add(callback);
      return { data: { subscription: { unsubscribe: () => control.authListeners.delete(callback) } } };
    },
    signOut: async (args) => { control.events.push('auth.signOut'); control.signOutCalls.push(args); return { error: null }; },
    rpc: async (name, args) => {
      control.events.push(`rpc.${name}`);
      control.rpcCalls.push({ name, args });
      if (name === 'get_member_password_access') { control.accessCalls.push(args); return { data: control.access, error: null }; }
      if (name === 'get_member_pending_review') return { data: control.pendingReview ? { status: 'pending_review' } : null, error: null };
      if (name === 'bind_member_device_session') { control.bindCalls.push(args); return { data: true, error: null }; }
      if (name === 'lookup_member_by_email') { control.fetchCalls.push(args); return { data: control.profile, error: null }; }
      return { data: null, error: null };
    },
    invoke: async (name, options) => { control.events.push(`functions.${name}`); control.invokeCalls.push({ name, options }); return { data: { ok: true, membership: control.membership }, error: null }; },
    bindMemberDeviceSession: async (...args) => { control.events.push('api.bind'); control.bindCalls.push(args); return true; },
    fetchMemberByEmail: async (...args) => { control.events.push('api.fetch'); control.fetchCalls.push(args); return control.profile; },
    getMemberPasswordAccess: async (...args) => { control.events.push('api.access'); control.accessCalls.push(args); return control.access; },
    fetchMemberInviteContext: async () => ({ valid: true }),
    submitMemberRegistrationInvite: async (...args) => { control.events.push('legacy.invite'); control.invokeCalls.push({ legacy: args }); },
  };
  control.emitAuthStateChange = (event, user = event === 'SIGNED_OUT' ? null : control.authUser) => {
    for (const callback of control.authListeners) callback(event, user ? { user } : null);
  };
  control.memberSupabase = {
    auth: {
      signInWithPassword: (...args) => control.signInWithPassword(...args),
      getSession: (...args) => control.getSession(...args),
      getUser: (...args) => control.getUser(...args),
      onAuthStateChange: (...args) => control.onAuthStateChange(...args),
      signOut: (...args) => control.signOut(...args),
      signUp: (...args) => { throw new Error(`forbidden signUp ${JSON.stringify(args)}`); },
      signInWithOtp: (...args) => { throw new Error(`forbidden signInWithOtp ${JSON.stringify(args)}`); },
      verifyOtp: (...args) => { throw new Error(`forbidden verifyOtp ${JSON.stringify(args)}`); },
    },
    rpc: (...args) => control.rpc(...args),
    functions: { invoke: (...args) => control.invoke(...args) },
  };
  return control;
}

let control;

function installControl() {
  control = makeControl();
  globalThis.__PASSWORD_TEST = control;
  globalThis.fetch = async (...args) => { throw new Error(`unexpected network ${String(args[0])}`); };
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  await Promise.resolve();
}
async function settleMore() {
  await settle();
  await settle();
}

function textOf(container) { return container.textContent || ''; }
function input(container, id) {
  const node = container.querySelector(`#${id}`);
  assert.ok(node, `missing #${id}`);
  return node;
}
function button(container, predicate) {
  return [...container.querySelectorAll('button')].find((node) => typeof predicate === 'string'
    ? (node.textContent || '').trim() === predicate
    : predicate(node)) ?? null;
}
function setInputValue(node, value) {
  const setter = Object.getOwnPropertyDescriptor(node.ownerDocument.defaultView.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(node, value); else node.value = value;
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  const onChange = reactPropsKey && node[reactPropsKey]?.onChange;
  if (typeof onChange === 'function') onChange({ target: node, currentTarget: node });
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
}
async function setValue(container, id, value) {
  await act(async () => { setInputValue(input(container, id), value); await settle(); });
}
async function submit(container, id, twice = false) {
  await act(async () => {
    const form = input(container, id).closest('form');
    assert.ok(form, `#${id} has no form`);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    if (twice) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
  });
}
async function click(node) {
  assert.ok(node, 'expected button');
  await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await settle(); });
}

async function main() {
  const loginSource = await readFile(loginPath, 'utf8');
  const joinSource = await readFile(joinPath, 'utf8');
  const candidatePaths = [
    'frontend/src/features/auth/member-password.ts',
    'frontend/src/features/auth/member-password-api.ts',
    'frontend/src/features/auth/member-password-access.ts',
    'frontend/src/features/auth/MemberAccessGuard.tsx',
  ].map((path) => join(repositoryRoot, path));
  const availableCandidates = [];
  for (const path of candidatePaths) if (await exists(path)) availableCandidates.push(path);
  const implementationSources = await Promise.all(availableCandidates.map((path) => readFile(path, 'utf8')));
  const markerSource = `${loginSource}\n${joinSource}\n${implementationSources.join('\n')}`;
  const missingContract = availableCandidates.length < candidatePaths.length
    || !markerSource.includes('get_member_password_access')
    || !markerSource.includes('member-password-enrollment');
  if (missingContract) {
    console.log('NOT READY member-password mounted component harness: new frontend password Login/Join implementation is not present yet.');
    console.log(`Contract: ${join(repositoryRoot, '..', 'phantoms-password-migration/IMPLEMENTATION_CONTRACT.md')}`);
    console.log('Missing required frontend markers/modules: get_member_password_access, member-password-enrollment, and at least one member-password helper/API/access-guard module.');
    console.log(`Available candidate modules: ${availableCandidates.length ? availableCandidates.map((path) => relative(repositoryRoot, path)).join(', ') : 'none'}`);
    console.log('No mounted scenarios executed; parent must rerun after the frontend agent lands the contract implementation.');
    return { ran: 0, passed: 0, failures: 0, notReady: true };
  }

  const harnessRoot = await mkdtemp(join(tmpdir(), 'phantoms-member-password-component-'));
  const dom = installDom();
    let root;
    let currentPath = '';
    const locationHistory = [];
  const container = dom.window.document.getElementById('root');
  const failures = [];
  const originalLocation = `${dom.window.location.pathname}${dom.window.location.search}${dom.window.location.hash}`;
  try {
    await writeHarnessFiles(harnessRoot);
    installControl();
    const store = createRequire(join(harnessRoot, 'src/store/auth.js'))(join(harnessRoot, 'src/store/auth.js'));
    const { default: LoginPage } = createRequire(join(harnessRoot, 'src/features/auth/LoginPage.js'))(join(harnessRoot, 'src/features/auth/LoginPage.js'));
    const { default: MemberSelfRegisterPage } = createRequire(join(harnessRoot, 'src/features/members/MemberSelfRegisterPage.js'))(join(harnessRoot, 'src/features/members/MemberSelfRegisterPage.js'));
    const { MemberAccessGuard } = createRequire(join(harnessRoot, 'src/features/auth/MemberAccessGuard.js'))(join(harnessRoot, 'src/features/auth/MemberAccessGuard.js'));
    let scenarioCount = 0;

    function Controller() {
      const navigate = useNavigate();
      const location = useLocation();
      currentPath = `${location.pathname}${location.search}${location.hash}`;
      locationHistory.push(currentPath);
      globalThis.__PASSWORD_TEST.navigate = navigate;
      const element = currentPath.startsWith('/join') || currentPath.startsWith('/reset')
        ? React.createElement(MemberSelfRegisterPage)
        : currentPath.startsWith('/portal')
          ? React.createElement(MemberAccessGuard, null, React.createElement('div', { id: 'guard-child' }, 'portal'))
          : React.createElement(LoginPage);
      const routePath = currentPath.startsWith('/join/') ? '/join/:token' : '*';
      return React.createElement(Routes, null, React.createElement(Route, { path: routePath, element }));
    }

    async function mount(path = '/login', prepare = null) {
      installControl();
      if (prepare) prepare(control);
      store.__resetStore();
      dom.window.localStorage.clear();
      dom.window.sessionStorage.clear();
      if (path.startsWith('/portal')) {
        store.__setMember(MEMBER, true);
        store.setDeviceToken('guard-device-token', true);
      }
      dom.window.history.replaceState(null, '', path);
      currentPath = '';
      locationHistory.length = 0;
      container.replaceChildren();
      root = ReactDOMClient.createRoot(container);
      await act(async () => {
        root.render(React.createElement(React.StrictMode, null,
          React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Controller)),
        ));
        await settle();
      });
    }
    async function unmount() {
      if (root) {
        await act(async () => { root.unmount(); await settle(); });
        root = null;
      }
      container.replaceChildren();
    }
    async function scenario(name, fn, path = '/login', prepare = null) {
      try { await unmount(); await mount(path, prepare); await fn(); scenarioCount += 1; console.log(`PASS ${name}`); }
      catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    function assertNoForbiddenCalls() {
      assert.equal(control.signInCalls.length, 0, 'no password sign-in expected');
      assert.equal(control.invokeCalls.length, 0, 'no enrollment call expected');
      assert.equal(textOf(container).includes('OTP'), false, 'OTP UI must be absent');
      assert.equal(textOf(container).includes('رمز التحقق'), false, 'OTP instructions must be absent');
      assert.equal(textOf(container).includes('إرسال رمز'), false, 'OTP resend UI must be absent');
    }

    await scenario('StrictMode login mount is quiet; password UI has required controls and no OTP/signup/send-email calls', async () => {
      assert.ok(input(container, 'member-email'));
      assert.ok(input(container, 'member-password'));
      assert.ok(input(container, 'member-remember'));
      assertNoForbiddenCalls();
      assert.equal(textOf(container).includes('مسئول') || textOf(container).includes('مسؤول'), true, 'contact administrator recovery copy is required');
    });

    await scenario('login show/hide password toggles only the password input', async () => {
      const password = input(container, 'member-password');
      assert.equal(password.type, 'password');
      const toggle = button(container, (node) => /show|hide|إظهار|إخفاء|كلمة المرور/i.test(`${node.getAttribute('aria-label') || ''} ${node.title || ''} ${node.textContent || ''}`));
      assert.ok(toggle, 'show/hide control missing');
      await click(toggle);
      assert.equal(input(container, 'member-password').type, 'text');
      await click(toggle);
      assert.equal(input(container, 'member-password').type, 'password');
    });

    await scenario('malformed email and missing/short password validate before endpoint', async () => {
      await setValue(container, 'member-email', 'not-an-email');
      await setValue(container, 'member-password', WEAK_PASSWORD);
      await submit(container, 'member-email');
      assert.equal(control.signInCalls.length, 0);
      assert.match(textOf(container), /بريد|صيغة|كلمة المرور|اتأكد/);
    });

    await scenario('valid password login is single-flight and preserves captured normalized recipient', async () => {
      const pending = deferred();
      control.signInWithPassword = async (args) => { control.events.push('auth.signInWithPassword'); control.signInCalls.push(args); return pending.promise; };
      await setValue(container, 'member-email', `  ${EMAIL.toUpperCase()}  `);
      await setValue(container, 'member-password', PASSWORD);
      await submit(container, 'member-email', true);
      assert.equal(control.signInCalls.length, 1, 'same-tick double submit must produce one sign-in');
      assert.deepEqual(control.signInCalls[0], { email: EMAIL, password: PASSWORD });
      assert.equal(input(container, 'member-email').disabled, true);
      assert.equal(input(container, 'member-password').disabled, true);
      pending.resolve({ data: { user: control.authUser }, error: null });
      await act(async () => { await settle(); });
    });

    await scenario('successful login order is auth then access with matching UID then bind then matching profile then remember commit then portal', async () => {
      await setValue(container, 'member-email', EMAIL);
      await setValue(container, 'member-password', PASSWORD);
      await submit(container, 'member-email');
      await act(async () => { await settleMore(); });
      const order = control.events.filter((event) => /signInWithPassword|auth.getUser|rpc.get_member_password_access|api.access|rpc.bind_member_device_session|api.bind|lookup_member_by_email|api.fetch|setMember/.test(event));
      assert.ok(order.findIndex((x) => /signInWithPassword/.test(x)) >= 0);
      assert.ok(order.findIndex((x) => /get_member_password_access|api.access/.test(x)) > order.findIndex((x) => /signInWithPassword/.test(x)));
      assert.ok(order.findIndex((x) => /bind_member_device_session|api.bind/.test(x)) > order.findIndex((x) => /get_member_password_access|api.access/.test(x)));
      assert.ok(order.findIndex((x) => /lookup_member_by_email|api.fetch/.test(x)) > order.findIndex((x) => /bind_member_device_session|api.bind/.test(x)));
      assert.ok(locationHistory.includes('/portal'), `expected portal navigation, got ${locationHistory.join(',')}`);
      assert.equal(control.setMemberCalls.length, 1);
      assert.equal(control.signOutCalls.length, 0);
    });

    await scenario('wrong password is generic, retains email, and does not perform access/bind/profile or fake-email behavior', async () => {
      control.signInWithPassword = async (args) => { control.signInCalls.push(args); return { data: { user: null }, error: { code: 'invalid_credentials', message: 'secret password detail' } }; };
      await setValue(container, 'member-email', EMAIL);
      await setValue(container, 'member-password', 'WrongPassword9!');
      await submit(container, 'member-email');
      assert.equal(control.accessCalls.length, 0);
      assert.equal(control.bindCalls.length, 0);
      assert.equal(control.fetchCalls.length, 0);
      assert.equal(input(container, 'member-email').value, EMAIL);
      assert.equal(textOf(container).includes('secret password detail'), false);
      assert.notEqual(currentPath, '/portal');
    });

    await scenario('unmapped/nonmember and disabled/unready access fail closed before bind', async () => {
      control.access = null;
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.equal(control.bindCalls.length, 0);
      assert.notEqual(currentPath, '/portal');
      await unmount(); await mount(); control.access = { ...control.access, active: false, password_ready: false };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.equal(control.bindCalls.length, 0);
      assert.notEqual(currentPath, '/portal');
    });

    await scenario('new member with correct password is told approval is pending and receives no portal session', async () => {
      control.access = null;
      control.pendingReview = true;
      await setValue(container, 'member-email', EMAIL);
      await setValue(container, 'member-password', PASSWORD);
      await submit(container, 'member-email');
      await act(async () => { await settleMore(); });
      assert.equal(control.rpcCalls.some((call) => call.name === 'get_member_pending_review'), true);
      assert.equal(control.bindCalls.length, 0);
      assert.equal(control.setMemberCalls.length, 0);
      assert.equal(control.signOutCalls.length, 1);
      assert.notEqual(currentPath, '/portal');
      assert.match(textOf(container), /مراجعة الإدارة|تفعيل العضوية/);
    });

    await scenario('Auth UID/email mismatch, profile UID/email mismatch, and profile failure all fail closed', async () => {
      control.access = { ...control.access, auth_user_id: OTHER_UID };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.equal(control.bindCalls.length, 0);
      await unmount(); await mount(); control.access = { ...control.access, auth_user_id: AUTH_UID }; control.authUser = { id: AUTH_UID, email: OTHER_EMAIL };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.equal(control.bindCalls.length, 0);
      await unmount(); await mount(); control.profile = { ...MEMBER, auth_user_id: OTHER_UID };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.notEqual(currentPath, '/portal');
    });

    await scenario('device binding failure cleans only local member Auth and never persists or navigates', async () => {
      control.bindMemberDeviceSession = async (...args) => { control.bindCalls.push(args); throw new Error('secret device failure'); };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.equal(control.setMemberCalls.length, 0);
      assert.deepEqual(control.signOutCalls, [{ scope: 'local' }]);
      assert.notEqual(currentPath, '/portal');
      assert.equal(dom.window.localStorage.getItem('phantoms_member_session'), null);
    });

    await scenario('remember false keeps the full member session in sessionStorage and never localStorage', async () => {
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD);
      const remember = input(container, 'member-remember');
      if (remember.checked) await click(remember);
      await submit(container, 'member-email');
      await act(async () => { await settleMore(); });
      assert.equal(control.setMemberCalls.at(-1)?.remember, false);
      assert.equal(dom.window.localStorage.getItem('phantoms_member_session'), null);
      assert.ok(dom.window.sessionStorage.getItem('phantoms_member_session'));
      assert.ok(dom.window.sessionStorage.getItem('phantoms_device_token'));
    });

    await scenario('remember transition/storage failure blocks Auth and persistence', async () => {
      control.rememberTransition = { ok: false, migrated: false, requiresReauthentication: true };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD); await submit(container, 'member-email');
      assert.equal(control.signInCalls.length, 0);
      assert.equal(control.setMemberCalls.length, 0);
      assert.equal(dom.window.localStorage.getItem('phantoms_member_session'), null);
      assert.equal(dom.window.sessionStorage.getItem('phantoms_member_session'), null);
    });

    await scenario('unmount before Auth completion ignores stale completion and performs no late persist/navigate', async () => {
      const pending = deferred();
      control.signInWithPassword = async (args) => { control.signInCalls.push(args); return pending.promise; };
      await setValue(container, 'member-email', EMAIL); await setValue(container, 'member-password', PASSWORD);
      await submit(container, 'member-email');
      await unmount();
      pending.resolve({ data: { user: control.authUser }, error: null });
      await act(async () => { await settle(); });
      assert.equal(control.setMemberCalls.length, 0);
      assert.equal(control.deviceCalls.length, 0);
      assert.notEqual(currentPath, '/portal');
    });

    await scenario('persisted member portal mount revalidates Auth user, password access, and bound profile ID/email before rendering children', async () => {
      assert.ok(control.getUserCalls.length >= 1, 'guard must revalidate the member Auth user');
      assert.ok(control.accessCalls.length >= 1, 'guard must call get_member_password_access');
      assert.ok(control.fetchCalls.length >= 1, 'guard must revalidate the bound member profile');
      assert.ok(container.querySelector('#guard-child'), 'guard must render children only after checks pass');
    }, '/portal');

    await scenario('guard unmount during getUser failure still clears only member-local state', async () => {
      const adminSentinel = 'admin-storage-must-survive-getUser-failure';
      dom.window.localStorage.setItem('phantoms_admin_sentinel', adminSentinel);
      await unmount();
      globalThis.__PASSWORD_TEST_GETUSER_PENDING.reject(new Error('getUser failed after unmount'));
      await act(async () => { await settleMore(); });
      assert.deepEqual(control.signOutCalls, [{ scope: 'local' }]);
      assert.equal(store.getState().currentMember, null);
      assert.equal(dom.window.localStorage.getItem('phantoms_device_token'), null);
      assert.equal(dom.window.localStorage.getItem('phantoms_admin_sentinel'), adminSentinel);
    }, '/portal', (nextControl) => {
      const pending = deferred();
      nextControl.getUser = async () => { nextControl.getUserCalls.push({}); return pending.promise; };
      // The scenario reads this closure after the StrictMode mount.
      globalThis.__PASSWORD_TEST_GETUSER_PENDING = pending;
    });

    await scenario('guard unmount during access failure still clears member state', async () => {
      const adminSentinel = 'admin-storage-must-survive-access-failure';
      dom.window.localStorage.setItem('phantoms_admin_sentinel', adminSentinel);
      await unmount();
      globalThis.__PASSWORD_TEST_ACCESS_PENDING.reject(new Error('access failed after unmount'));
      await act(async () => { await settleMore(); });
      assert.deepEqual(control.signOutCalls, [{ scope: 'local' }]);
      assert.equal(store.getState().currentMember, null);
      assert.equal(dom.window.localStorage.getItem('phantoms_admin_sentinel'), adminSentinel);
    }, '/portal', (nextControl) => {
      const pending = deferred();
      const baseRpc = nextControl.rpc;
      nextControl.rpc = async (name, args) => {
        if (name === 'get_member_password_access') { nextControl.accessCalls.push(args); return pending.promise; }
        return baseRpc(name, args);
      };
      globalThis.__PASSWORD_TEST_ACCESS_PENDING = pending;
    });

    await scenario('guard unmount during profile failure still clears member state', async () => {
      const adminSentinel = 'admin-storage-must-survive-profile-failure';
      dom.window.localStorage.setItem('phantoms_admin_sentinel', adminSentinel);
      await unmount();
      globalThis.__PASSWORD_TEST_PROFILE_PENDING.reject(new Error('profile failed after unmount'));
      await act(async () => { await settleMore(); });
      assert.deepEqual(control.signOutCalls, [{ scope: 'local' }]);
      assert.equal(store.getState().currentMember, null);
      assert.equal(dom.window.localStorage.getItem('phantoms_admin_sentinel'), adminSentinel);
    }, '/portal', (nextControl) => {
      const pending = deferred();
      nextControl.fetchMemberByEmail = async (...args) => { nextControl.fetchCalls.push(args); return pending.promise; };
      globalThis.__PASSWORD_TEST_PROFILE_PENDING = pending;
    });

    await scenario('stale unmounted guard failure cannot clear a newer valid member login', async () => {
      await unmount();
      control.authUser = { id: OTHER_UID, email: OTHER_EMAIL };
      control.profile = OTHER_MEMBER;
      store.__setMember(OTHER_MEMBER, true);
      store.setDeviceToken('new-member-device', true);
      globalThis.__PASSWORD_TEST_GETUSER_PENDING.reject(new Error('stale old verification failure'));
      await act(async () => { await settleMore(); });
      assert.equal(control.signOutCalls.length, 0);
      assert.equal(store.getState().currentMember?.id, OTHER_MEMBER.id);
      assert.equal(control.deviceCalls.at(-1)?.token, 'new-member-device');
    }, '/portal', (nextControl) => {
      const pending = deferred();
      nextControl.getUser = async () => { nextControl.getUserCalls.push({}); return pending.promise; };
      globalThis.__PASSWORD_TEST_GETUSER_PENDING = pending;
    });

    await scenario('member identity changes during verification rechecks without cleaning the newer member', async () => {
      control.authUser = { id: AUTH_UID, email: EMAIL };
      await act(async () => {
        store.__setMember(MEMBER, true);
        store.setDeviceToken('member-change-old-device', true);
        await settle();
      });
      control.authUser = { id: OTHER_UID, email: OTHER_EMAIL };
      control.profile = OTHER_MEMBER;
      await act(async () => {
        store.__setMember(OTHER_MEMBER, true);
        store.setDeviceToken('member-change-new-device', true);
        await settleMore();
      });
      globalThis.__PASSWORD_TEST_MEMBER_CHANGE_PENDING.reject(new Error('old member verification failed'));
      await act(async () => { await settleMore(); });
      assert.equal(control.signOutCalls.length, 0);
      assert.equal(store.getState().currentMember?.id, OTHER_MEMBER.id);
      assert.ok(container.querySelector('#guard-child'));
    }, '/portal', (nextControl) => {
      nextControl.getUser = async () => { nextControl.getUserCalls.push({}); return { data: { user: nextControl.authUser }, error: null }; };
      const baseRpc = nextControl.rpc;
      let pendingAccessCalls = 0;
      const pending = deferred();
      nextControl.rpc = async (name, args) => {
        if (name === 'get_member_password_access') {
          pendingAccessCalls += 1;
          if (pendingAccessCalls <= 2) return pending.promise;
          return { data: { member_id: OTHER_MEMBER.id, email: OTHER_MEMBER.email, auth_user_id: OTHER_UID, active: true, password_ready: true }, error: null };
        }
        return baseRpc(name, args);
      };
      globalThis.__PASSWORD_TEST_MEMBER_CHANGE_PENDING = pending;
    });

    await scenario('member auth logout clears member state without touching Admin state', async () => {
      const adminSentinel = 'admin-storage-must-survive-member-logout';
      dom.window.localStorage.setItem('phantoms_admin_sentinel', adminSentinel);
      control.authUser = null;
      await act(async () => {
        control.emitAuthStateChange('SIGNED_OUT', null);
        await settleMore();
      });
      assert.deepEqual(control.signOutCalls, [{ scope: 'local' }]);
      assert.equal(store.getState().currentMember, null);
      assert.equal(dom.window.localStorage.getItem('phantoms_admin_sentinel'), adminSentinel);
      assert.notEqual(currentPath, '/portal');
    }, '/portal');

    await scenario('join captures invite hash, scrubs URL, and never persists plaintext token', async () => {
      assert.equal(currentPath, '/join', 'hash invite must be scrubbed from the mounted router location');
      assert.equal(dom.window.localStorage.getItem('member-invite-token'), null);
      assert.equal(dom.window.sessionStorage.getItem('member-invite-token'), null);
      assert.equal(container.querySelector('#join-token'), null, 'the member must open the link; no manual token field is displayed');
      assert.equal(textOf(container).includes(TOKEN), false);
      assertNoForbiddenCalls();
    }, `/join#invite=${TOKEN}`);

    await scenario('join without an invite link requests a fresh link and has no manual code field', async () => {
      assert.equal(container.querySelector('#join-token'), null);
      await setValue(container, 'join-email', EMAIL);
      await setValue(container, 'join-password', PASSWORD);
      await setValue(container, 'join-confirm-password', PASSWORD);
      await submit(container, 'join-email');
      assert.equal(control.invokeCalls.length, 0);
      assert.match(textOf(container), /افتح رابط الدعوة|رابطاً جديداً/);
    }, '/join');

    for (const [label, path] of [
      ['query', `/join?invite=${TOKEN}`],
      ['legacy path', `/join/${TOKEN}`],
    ]) {
      await scenario(`join ${label} token is scrubbed and cannot auto-populate or submit`, async () => {
        await act(async () => { await settleMore(); });
        assert.equal(currentPath, '/join', `${label} token must be scrubbed from the mounted router location`);
        assert.equal(container.querySelector('#join-token'), null);
        await setValue(container, 'join-email', EMAIL);
        await setValue(container, 'join-password', PASSWORD);
        await setValue(container, 'join-confirm-password', PASSWORD);
        await submit(container, 'join-email');
        assert.equal(control.invokeCalls.length, 0, `${label} token must never reach enrollment`);
        assert.equal(textOf(container).includes(TOKEN), false);
        assertNoForbiddenCalls();
      }, path);
    }

    await scenario('join fragment link remains private while email/profile/password validation stays before endpoint', async () => {
      assert.equal(container.querySelector('#join-token'), null);
      await setValue(container, 'join-email', 'not-an-email'); await setValue(container, 'join-full-name', 'Member Test'); await setValue(container, 'join-password', PASSWORD); await setValue(container, 'join-confirm-password', PASSWORD); await submit(container, 'join-email');
      assert.equal(control.invokeCalls.length, 0);
      await setValue(container, 'join-email', EMAIL); await setValue(container, 'join-full-name', ''); await submit(container, 'join-email');
      assert.equal(control.invokeCalls.length, 0);
      await setValue(container, 'join-full-name', 'Member Test'); await setValue(container, 'join-password', PASSWORD); await setValue(container, 'join-confirm-password', 'Different9!'); await submit(container, 'join-email');
      assert.equal(control.invokeCalls.length, 0);
      await setValue(container, 'join-confirm-password', PASSWORD); await setValue(container, 'join-password', WEAK_PASSWORD); await submit(container, 'join-email');
      assert.equal(control.invokeCalls.length, 0);
      assert.match(textOf(container), /دعوة|رابط|كلمة المرور|متطابق|قوي|12/);
    }, `/join#invite=${TOKEN}`);

    await scenario('valid join sends only recipient-entered profile/password data, clears secrets and reports pending review without Auth sign-in', async () => {
      assert.equal(container.querySelector('#join-token'), null);
      await setValue(container, 'join-email', ` ${EMAIL.toUpperCase()} `); await setValue(container, 'join-full-name', 'Member Test'); await setValue(container, 'join-phone', ''); await setValue(container, 'join-password', PASSWORD); await setValue(container, 'join-confirm-password', PASSWORD); await submit(container, 'join-email');
      assert.equal(control.invokeCalls.length, 1);
      const invocation = control.invokeCalls[0];
      assert.equal(invocation.name, 'member-password-enrollment');
      const body = invocation.options?.body ?? invocation.body;
      assert.deepEqual(Object.keys(body).sort(), ['action', 'confirmPassword', 'email', 'password', 'profile', 'token'].sort());
      assert.equal(body.action, 'enroll'); assert.equal(body.email, EMAIL); assert.equal(body.token, TOKEN); assert.equal(body.password, PASSWORD); assert.equal(body.confirmPassword, PASSWORD);
      assert.deepEqual(body.profile, { fullName: 'Member Test', phone: '', residence: '', workConditions: '', bio: '', device: '', gender: '' });
      assert.equal(Object.hasOwn(body, 'memberId'), false); assert.equal(Object.hasOwn(body, 'role'), false); assert.equal(Object.hasOwn(body, 'authUserId'), false);
      assert.equal(control.signInCalls.length, 0);
      await act(async () => { await settleMore(); });
      assert.equal(currentPath, '/join', 'successful join remains on the explicit confirmation screen');
      const confirmation = container.querySelector('[data-testid="member-enrollment-success"]');
      assert.ok(confirmation, 'successful join must show server-confirmed completion');
      assert.match(confirmation.textContent ?? '', /وصلت بياناتك للإدارة/);
      assert.equal(container.querySelector('#join-password'), null);
      assert.equal(container.querySelector('#join-confirm-password'), null);
      assert.equal(container.querySelector('#join-token'), null);
      for (const storage of [dom.window.localStorage, dom.window.sessionStorage]) {
        for (let i = 0; i < storage.length; i += 1) {
          const value = storage.getItem(storage.key(i)) ?? '';
          assert.equal(value.includes(TOKEN) || value.includes(PASSWORD), false, 'no enrollment credential is persisted');
        }
      }
      assert.equal(dom.window.localStorage.getItem('member-invite-token'), null); assert.equal(dom.window.sessionStorage.getItem('member-invite-token'), null);
      assert.match(textOf(container), /مراجعة|تم استلام|حساب/);
    }, `/join#invite=${TOKEN}`);

    await scenario('password-only reset route sends no profile fields and preserves the existing member data', async () => {
      control.membership = 'active';
      assert.equal(currentPath, '/reset', 'reset fragment is scrubbed without changing the reset route');
      assert.equal(container.querySelector('#join-full-name'), null, 'reset must not ask the member to re-enter their profile');
      assert.equal(container.querySelector('#join-token'), null, 'reset uses the link fragment without a manual token field');
      await setValue(container, 'join-email', EMAIL);
      await setValue(container, 'join-password', PASSWORD);
      await setValue(container, 'join-confirm-password', PASSWORD);
      await submit(container, 'join-email');
      const body = control.invokeCalls[0]?.options?.body;
      assert.deepEqual(Object.keys(body).sort(), ['action', 'confirmPassword', 'email', 'password', 'token'].sort());
      assert.equal(Object.hasOwn(body, 'profile'), false);
      assert.equal(control.signInCalls.length, 0);
      await act(async () => { await settleMore(); });
      assert.equal(currentPath, '/reset', 'successful password reset remains on its confirmation screen');
      const confirmation = container.querySelector('[data-testid="member-enrollment-success"]');
      assert.ok(confirmation, 'successful reset must show server-confirmed completion');
      assert.match(confirmation.textContent ?? '', /تم حفظ كلمة المرور الجديدة/);
    }, `/reset#invite=${TOKEN}`);

    for (const code of ['EXPIRED', 'REVOKED', 'ALREADY_USED', 'INVALID_TOKEN']) {
      await scenario(`join ${code} is a safe error with no secret leakage`, async () => {
        control.invoke = async (name, options) => { control.invokeCalls.push({ name, options }); return { data: null, error: { code, message: `secret ${code} SQL` } }; };
        await setValue(container, 'join-email', EMAIL); await setValue(container, 'join-full-name', 'Member Test'); await setValue(container, 'join-password', PASSWORD); await setValue(container, 'join-confirm-password', PASSWORD); await submit(container, 'join-email');
        assert.equal(textOf(container).includes(`secret ${code}`), false);
        assert.equal(textOf(container).includes('SQL'), false);
        assert.notEqual(currentPath, '/portal');
      }, `/join#invite=${TOKEN}`);
    }

    await scenario('join network failure permits an explicit retry without duplicating stale submit state', async () => {
      let attempts = 0;
      control.invoke = async (name, options) => { attempts += 1; control.invokeCalls.push({ name, options }); if (attempts === 1) return { data: null, error: { code: 'SERVER_UNAVAILABLE', message: 'secret network' } }; return { data: { ok: true, membership: 'pending_review' }, error: null }; };
      await setValue(container, 'join-email', EMAIL); await setValue(container, 'join-full-name', 'Member Test'); await setValue(container, 'join-password', PASSWORD); await setValue(container, 'join-confirm-password', PASSWORD); await submit(container, 'join-email');
      assert.equal(textOf(container).includes('secret network'), false);
      const retry = button(container, (node) => /حاول|تاني|إعادة|retry/i.test(node.textContent || ''));
      if (retry) await click(retry); else await submit(container, 'join-email');
      assert.equal(attempts, 2);
      assert.equal(control.signInCalls.length, 0);
    }, `/join#invite=${TOKEN}`);

    await scenario('join double-submit is single-flight with captured recipient and unmount ignores completion', async () => {
      const pending = deferred();
      control.invoke = async (name, options) => { control.invokeCalls.push({ name, options }); return pending.promise; };
      await setValue(container, 'join-email', EMAIL); await setValue(container, 'join-full-name', 'Member Test'); await setValue(container, 'join-password', PASSWORD); await setValue(container, 'join-confirm-password', PASSWORD);
      await submit(container, 'join-email', true);
      assert.equal(control.invokeCalls.length, 1);
      assert.equal((control.invokeCalls[0].options?.body ?? {}).email, EMAIL);
      await unmount(); pending.resolve({ data: { ok: true, membership: 'pending_review' }, error: null }); await act(async () => { await settle(); });
      assert.equal(control.signInCalls.length, 0);
      assert.equal(dom.window.localStorage.getItem('phantoms_member_session'), null);
    }, `/join#invite=${TOKEN}`);

    await scenario('contact administrator is recovery-only: no reset email or public signup endpoint', async () => {
      assert.match(textOf(container), /مسؤول|مشكلة|الإدارة/);
      assert.equal(control.invokeCalls.length, 0); assert.equal(control.signInCalls.length, 0);
      assertNoForbiddenCalls();
    });

    await unmount();
    if (failures.length) {
      const summary = failures.map(({ name, error }) => `${name}: ${error instanceof Error ? error.stack || error.message : String(error)}`).join('\n\n');
      throw new Error(`${failures.length} mounted password regression scenario(s) failed:\n${summary}`);
    }
    console.log(`Mounted/mocked React19 Router StrictMode password regression: ${scenarioCount} scenarios passed`);
    return { ran: scenarioCount, passed: scenarioCount, failures: 0, notReady: false };
  } finally {
    delete globalThis.__PASSWORD_TEST;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
    await rm(harnessRoot, { recursive: true, force: true });
    // Restore the disposable JSDOM URL after each process-local run.
    try { dom.window.history.replaceState(null, '', originalLocation); } catch {}
  }
}

await main();
