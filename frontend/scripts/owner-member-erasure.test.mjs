import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRequire = createRequire(join(frontendRoot, 'package.json'));
const { JSDOM } = frontendRequire('jsdom');
const ts = frontendRequire('typescript');
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER_ID = 42;
const CONFIRMATION = `ERASE ${MEMBER_ID} ${TARGET_ID.slice(0, 8)}`;
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
};
function compileCommonJs(source, fileName) {
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText;
}
const harnessRoot = await mkdtemp(join(tmpdir(), 'phantoms-owner-member-erasure-'));
async function writeHarnessFiles() {
  await writeFile(join(harnessRoot, 'package.json'), '{"type":"commonjs"}\n');
  await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');
  for (const relative of [
    'features/members/owner-member-erasure-api.ts',
    'features/members/OwnerMemberErasure.tsx',
  ]) {
    const sourcePath = join(frontendRoot, 'src', relative);
    const outputPath = join(harnessRoot, 'src', relative.replace(/\.tsx?$/, '.js'));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, compileCommonJs(await readFile(sourcePath, 'utf8'), sourcePath));
  }
  const stubs = new Map([
    ['src/lib/supabase/client.js', `
exports.supabase = { functions: { invoke(name, options) { return globalThis.__ERASURE_INVOKE(name, options); } } };
`],
    ['src/components/ui/Button.js', `
const React = require('react');
exports.Button = function Button({ children, icon, isLoading, loadingText, disabled, fullOnMobile, ...props }) {
  return React.createElement('button', { ...props, disabled: disabled || isLoading, 'aria-busy': isLoading || undefined }, icon, isLoading && loadingText ? loadingText : children);
};
`],
    ['src/components/ui/Modal.js', `
const React = require('react');
exports.Modal = function Modal({ isOpen, title, subtitle, children }) {
  return isOpen ? React.createElement('div', { role: 'dialog', 'aria-label': title }, React.createElement('h2', null, title), subtitle && React.createElement('p', null, subtitle), children) : null;
};
`],
    ['src/i18n/useLocale.js', `
exports.useLocale = function useLocale() {
  const language = globalThis.__ERASURE_LOCALE || 'en';
  return {
    t: (ar, en) => language === 'ar' ? ar : en,
    number: (value) => String(value),
    date: (value) => String(value),
    dir: language === 'ar' ? 'rtl' : 'ltr',
  };
};
`],
  ]);
  for (const [relative, contents] of stubs) {
    const destination = join(harnessRoot, relative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
}
function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/admin/members',
    pretendToBeVisual: true,
  });
  const previous = new Map();
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  return {
    restore() {
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}
function settle(turns = 6) {
  return (async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    }
  })();
}
const erasureHarness = {
  Preview: {
    operation_id: 'operation-preview-1',
    member_id: MEMBER_ID,
    auth_user_id: TARGET_ID,
    member_name: 'Example Member',
    email_masked: 'm***@example.test',
    preview_token: 'preview-token-fixture',
    expires_at: '2027-01-01T00:00:00.000Z',
    impacts: [
      { key: 'member_rows', label_ar: 'سجلات العضو', label_en: 'Member rows', count: 5 },
      { key: 'notes', label_ar: 'ملاحظات', label_en: 'Notes', count: 2 },
    ],
    shared_teams: [{ id: 'team-1', name: 'Shared team', other_member_count: 3 }],
    shared_projects: [
      { id: 'project-1', name: 'Shared project one', other_member_count: 4, dependent_rows: 7 },
      { id: 'project-2', name: 'Shared project two', other_member_count: 2, dependent_rows: 3 },
    ],
    handover_requirements: [
      { kind: 'team_lead', entity_id: 101, entity_name: 'Team alpha', candidates: [{ member_id: 7, full_name: 'Eligible One' }, { member_id: 8, full_name: 'Eligible Two' }] },
      { kind: 'project_owner', entity_id: 'proj-a', entity_name: 'Project alpha', candidates: [{ member_id: 8, full_name: 'Eligible Two' }, { member_id: 9, full_name: 'Eligible Three' }] },
    ],
    storage_object_count: 6,
    owner_target: false,
    is_admin: false,
    blockers: [],
    can_execute: true,
  },
  Complete: {
    ok: true,
    status: 'complete',
    operation_id: 'operation-preview-1',
    deleted: { database_rows: 9, storage_objects: 6, auth_users: 1 },
    database_complete: true,
    storage_complete: true,
    auth_complete: true,
  },
  Partial: {
    ok: false,
    status: 'partial',
    operation_id: 'operation-preview-1',
    stage: 'storage_cleanup',
    retryable: true,
    message_ar: 'private-provider-detail@example.test',
    message_en: 'private-provider-detail@example.test',
  },
  PendingStatus: {
    ok: true,
    operation_id: 'operation-preview-1',
    status: 'pending',
    stage: 'storage_cleanup',
    retryable: false,
    database_complete: true,
    storage_complete: false,
    auth_complete: false,
    deleted: { database_rows: 4, storage_objects: 0, auth_users: 0 },
  },
  CompleteStatus: {
    ok: true,
    operation_id: 'operation-preview-1',
    status: 'complete',
    stage: 'complete',
    retryable: false,
    database_complete: true,
    storage_complete: true,
    auth_complete: true,
    deleted: { database_rows: 9, storage_objects: 6, auth_users: 1 },
  },
};
await writeHarnessFiles();
let environment = installDom();
const React = frontendRequire('react');
const { createRoot } = frontendRequire('react-dom/client');
const { act } = React;
const harnessRequire = createRequire(join(harnessRoot, 'package.json'));
const apiModule = harnessRequire('./src/features/members/owner-member-erasure-api.js');
const componentModule = harnessRequire('./src/features/members/OwnerMemberErasure.js');
const { QueryClient, QueryClientProvider } = harnessRequire('@tanstack/react-query');
let root;
let queryClient;
async function render(props = {}) {
  await unmount();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.getElementById('root'));
  const member = props.member ?? { id: MEMBER_ID, full_name: 'Local list name must not identify the target' };
  const component = React.createElement(componentModule.OwnerMemberErasure, {
    member,
    currentOwnerUserId: props.currentOwnerUserId ?? OWNER_ID,
    isOwner: props.isOwner ?? true,
    api: props.api,
  });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, component));
    await settle();
  });
}
async function unmount() {
  if (root) await act(async () => { root.unmount(); await settle(2); });
  root = null;
  queryClient?.clear();
}
function findButton(text) {
  return [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
}
async function click(button) {
  assert.ok(button, 'expected button to exist');
  await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await settle(); });
}
async function typeExactInput(value) {
  const input = document.querySelector('#owner-erasure-confirmation');
  assert.ok(input, 'confirmation input should be present after exact preview');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(2);
  });
}
async function selectSuccessor(index, value) {
  const select = document.querySelectorAll('select')[index];
  assert.ok(select, `handover selector ${index} should be present`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, String(value));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(2);
  });
}
async function showPreview() {
  await click(findButton('Erase identity + sign-in account + linked data'));
  await click(findButton('Request exact preview'));
  await act(async () => { await settle(); });
}
async function completeConfirmAndExecute() {
  await selectSuccessor(0, 7);
  await selectSuccessor(1, 9);
  await typeExactInput(CONFIRMATION);
  await click(findButton('Erase identity, account, and personal data'));
}
function fakeApi(overrides = {}) {
  return {
    preview: async () => structuredClone(erasureHarness.Preview),
    execute: async () => structuredClone(erasureHarness.Complete),
    status: async () => structuredClone(erasureHarness.PendingStatus),
    retry: async () => structuredClone(erasureHarness.Complete),
    ...overrides,
  };
}

try {
  await test('API uses exact preview, execute, status, and retry contracts with no shared-delete field', async () => {
    const calls = [];
    const replies = [
      { ok: true, preview: structuredClone(erasureHarness.Preview) },
      structuredClone(erasureHarness.Complete),
      structuredClone(erasureHarness.PendingStatus),
      structuredClone(erasureHarness.Complete),
    ];
    const api = apiModule.createOwnerMemberErasureApi({ functions: { invoke: async (name, options) => {
      calls.push({ name, options });
      return { data: replies.shift(), error: null };
    } } });
    const preview = await api.preview(MEMBER_ID);
    assert.deepEqual(calls[0], { name: 'owner-member-erasure', options: { body: { action: 'preview', member_id: MEMBER_ID } } });
    const assignments = { 'team_lead:101': 7, 'project_owner:proj-a': 9 };
    await api.execute(preview, assignments, CONFIRMATION);
    assert.deepEqual(calls[1], { name: 'owner-member-erasure', options: { body: {
      action: 'execute', operation_id: 'operation-preview-1', member_id: MEMBER_ID, auth_user_id: TARGET_ID,
      preview_token: 'preview-token-fixture', successor_assignments: assignments, confirmation: CONFIRMATION,
    } } });
    assert.deepEqual(Object.keys(calls[1].options.body).sort(), ['action', 'operation_id', 'member_id', 'auth_user_id', 'preview_token', 'successor_assignments', 'confirmation'].sort());
    assert.equal('include_shared_project_ids' in calls[1].options.body, false);
    assert.equal('include_shared_project_ids' in calls[1].options.body.successor_assignments, false);
    await api.status('operation-preview-1');
    assert.deepEqual(calls[2], { name: 'owner-member-erasure', options: { body: { action: 'status', operation_id: 'operation-preview-1' } } });
    await api.retry('operation-preview-1');
    assert.deepEqual(calls[3], { name: 'owner-member-erasure', options: { body: { action: 'retry', operation_id: 'operation-preview-1' } } });
    assert.equal(apiModule.ownerMemberErasureConfirmation(MEMBER_ID, TARGET_ID), CONFIRMATION);
    assert.equal(apiModule.isOwnerMemberErasureConfirmationValid(MEMBER_ID, TARGET_ID, `${CONFIRMATION} `), false);
  });

  await test('API rejects missing, extra, guessed, and duplicate handover assignments before execution', async () => {
    let invokeCount = 0;
    const api = apiModule.createOwnerMemberErasureApi({ functions: { invoke: async (_name, options) => {
      invokeCount += 1;
      return { data: options.body.action === 'preview' ? { ok: true, preview: structuredClone(erasureHarness.Preview) } : structuredClone(erasureHarness.Complete), error: null };
    } } });
    const preview = await api.preview(MEMBER_ID);
    for (const assignments of [
      { 'team_lead:101': 7 },
      { 'team_lead:101': 7, 'project_owner:proj-a': 12345 },
      { 'team_lead:101': 7, 'project_owner:proj-a': 9, 'extra:unknown': 8 },
    ]) {
      await assert.rejects(api.execute(preview, assignments, CONFIRMATION), (error) => error.code === 'invalid_preview');
    }
    assert.equal(invokeCount, 1, 'only the preview request should reach the function');
  });

  await test('API fails closed on incomplete completion flags and mismatched status IDs', async () => {
    let callIndex = 0;
    const api = apiModule.createOwnerMemberErasureApi({ functions: { invoke: async () => {
      const replies = [
        { ok: true, preview: structuredClone(erasureHarness.Preview) },
        { ...structuredClone(erasureHarness.Complete), storage_complete: false },
        { ...structuredClone(erasureHarness.PendingStatus), operation_id: 'some-other-operation' },
      ];
      return { data: replies[callIndex++], error: null };
    } } });
    const preview = await api.preview(MEMBER_ID);
    await assert.rejects(api.execute(preview, { 'team_lead:101': 7, 'project_owner:proj-a': 9 }, CONFIRMATION), (error) => error.code === 'request_failed');
    await assert.rejects(api.status('operation-preview-1'), (error) => error.code === 'request_failed');
  });

  await test('Owner-only CTA is absent until isOwner is confirmed', async () => {
    let calls = 0;
    await render({ isOwner: false, api: fakeApi({ preview: async () => { calls += 1; return erasureHarness.Preview; } }) });
    assert.equal(findButton('Erase identity + sign-in account + linked data'), undefined);
    assert.equal(calls, 0);
  });

  await test('preview displays exact server-bound IDs and shared entities read-only, with only server candidates selectable', async () => {
    const api = fakeApi();
    await render({ api });
    await showPreview();
    assert.match(document.body.textContent, new RegExp(TARGET_ID));
    assert.match(document.body.textContent, /Exact member ID/);
    assert.match(document.body.textContent, /Shared project one/);
    assert.match(document.body.textContent, /Shared project two/);
    assert.match(document.body.textContent, /Preserved shared projects/);
    assert.doesNotMatch(document.body.textContent, /Local list name must not identify the target/);
    assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 0);
    assert.equal(document.querySelectorAll('select').length, 2);
    for (const [index, expectedIds] of [[0, ['7', '8']], [1, ['8', '9']]]) {
      const values = [...document.querySelectorAll('select')[index].options].slice(1).map((option) => option.value);
      assert.deepEqual(values, expectedIds);
    }
    assert.equal(findButton('Erase identity, account, and personal data').disabled, true);
    await selectSuccessor(0, 7);
    assert.equal(findButton('Erase identity, account, and personal data').disabled, true, 'all handovers and confirmation are required');
    await selectSuccessor(1, 9);
    assert.equal(findButton('Erase identity, account, and personal data').disabled, true, 'confirmation remains required');
  });

  await test('execute includes every explicit successor and never includes shared-project deletion', async () => {
    let executeArgs;
    const api = fakeApi({ execute: async (...args) => { executeArgs = args; return structuredClone(erasureHarness.Complete); } });
    await render({ api });
    await showPreview();
    await completeConfirmAndExecute();
    assert.deepEqual(executeArgs[1], { 'team_lead:101': 7, 'project_owner:proj-a': 9 });
    assert.equal(Object.keys(executeArgs[1]).some((key) => /project/i.test(key) && /include|delete/i.test(key)), false);
    assert.equal(executeArgs[2], CONFIRMATION);
    assert.match(document.body.textContent, /Erasure complete — confirmed by the server/);
  });

  await test('server blockers prohibit execution and show no-delete outcome', async () => {
    let executeCalls = 0;
    const blockedPreview = { ...structuredClone(erasureHarness.Preview), can_execute: false, blockers: [{ code: 'SHARED_ATTRIBUTION_UNSAFE' }] };
    const api = fakeApi({ preview: async () => blockedPreview, execute: async () => { executeCalls += 1; return erasureHarness.Complete; } });
    await render({ api });
    await showPreview();
    assert.match(document.body.textContent, /The server blocked execution/);
    assert.match(document.body.textContent, /No deletion started/);
    assert.equal(findButton('Erase identity, account, and personal data'), undefined);
    assert.equal(executeCalls, 0);
  });

  await test('primary-owner and signed-in self targets are blocked before execute', async () => {
    for (const scenario of [
      { owner_target: true, auth_user_id: TARGET_ID, currentOwnerUserId: OWNER_ID },
      { owner_target: false, auth_user_id: OWNER_ID, currentOwnerUserId: OWNER_ID },
    ]) {
      let executeCalls = 0;
      const api = fakeApi({ preview: async () => ({ ...structuredClone(erasureHarness.Preview), ...scenario }), execute: async () => { executeCalls += 1; return erasureHarness.Complete; } });
      await render({ api, currentOwnerUserId: scenario.currentOwnerUserId });
      await showPreview();
      assert.match(document.body.textContent, /Execution is blocked: this is your current account or the primary owner/);
      assert.equal(document.querySelector('#owner-erasure-confirmation'), null);
      assert.equal(findButton('Erase identity, account, and personal data'), undefined);
      assert.equal(executeCalls, 0);
      await unmount();
    }
  });

  await test('uncertain execute checks the same operation status and never claims success while pending', async () => {
    let executeCalls = 0;
    const statusCalls = [];
    const api = fakeApi({
      execute: async () => { executeCalls += 1; throw new Error('private provider transport failure'); },
      status: async (operationId) => { statusCalls.push(operationId); return structuredClone(erasureHarness.PendingStatus); },
    });
    await render({ api });
    await showPreview();
    await completeConfirmAndExecute();
    assert.equal(executeCalls, 1);
    assert.match(document.body.textContent, /Outcome is uncertain/);
    assert.doesNotMatch(document.body.textContent, /private provider|Erasure complete/);
    await click(findButton('Check this operation’s status'));
    assert.deepEqual(statusCalls, ['operation-preview-1']);
    assert.match(document.body.textContent, /Operation is still pending/);
    assert.doesNotMatch(document.body.textContent, /Erasure complete/);
    assert.equal(findButton('Retry the server-designated operation'), undefined);
    assert.equal(executeCalls, 1, 'an uncertain execute must not be resubmitted');
  });

  await test('status can resolve uncertainty as complete only with every completion flag true', async () => {
    const api = fakeApi({
      execute: async () => { throw new Error('unknown outcome'); },
      status: async () => structuredClone(erasureHarness.CompleteStatus),
    });
    await render({ api });
    await showPreview();
    await completeConfirmAndExecute();
    await click(findButton('Check this operation’s status'));
    assert.match(document.body.textContent, /Erasure complete — confirmed by the server/);
  });

  await test('partial and retryable remains partial until same-operation retry returns complete', async () => {
    const retryCalls = [];
    const api = fakeApi({
      execute: async () => structuredClone(erasureHarness.Partial),
      retry: async (operationId) => { retryCalls.push(operationId); return structuredClone(erasureHarness.Complete); },
    });
    await render({ api });
    await showPreview();
    await completeConfirmAndExecute();
    assert.match(document.body.textContent, /Partial operation — completion is not confirmed/);
    assert.doesNotMatch(document.body.textContent, /Erasure complete|private-provider-detail@example\.test/);
    await click(findButton('Retry the server-designated operation'));
    assert.deepEqual(retryCalls, ['operation-preview-1']);
    assert.match(document.body.textContent, /Erasure complete — confirmed by the server/);
  });

  await test('legacy profile-record deletion remains distinct and explicitly labeled only', async () => {
    const pageSource = await readFile(join(frontendRoot, 'src/features/members/MembersPage.tsx'), 'utf8');
    const cardsSource = await readFile(join(frontendRoot, 'src/features/members/MemberCards.tsx'), 'utf8');
    const apiSource = await readFile(join(frontendRoot, 'src/features/members/owner-member-erasure-api.ts'), 'utf8');
    assert.match(pageSource, /DELETE_UNDO_MS = 5000/);
    assert.match(pageSource, /حذف سجل العضو فقط/);
    assert.match(cardsSource, /حذف سجل العضو فقط/);
    assert.match(apiSource, /functions\.invoke\('owner-member-erasure'/);
    assert.doesNotMatch(apiSource, /include_shared_project_ids/);
    assert.doesNotMatch(apiSource, /\.from\(|service[_-]?role/i);
  });
} finally {
  await unmount();
  environment?.restore();
  await rm(harnessRoot, { recursive: true, force: true });
}
