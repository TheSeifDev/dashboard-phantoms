import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveGithubHandle } from '../src/features/dashboard/github.ts';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const github = read('src/features/dashboard/github.ts');
const avatar = read('src/components/ui/MemberAvatar.tsx');
const identityHook = read('src/features/portal/useIdentityAvatar.ts');
const portalLayout = read('src/features/portal/MemberPortalLayout.tsx');
const portalHeader = read('src/features/portal/PortalHeader.tsx');
const sidebar = read('src/components/layout/AppSidebar.tsx');
const githubLinkApi = read('src/features/members/github-link-api.ts');
const databaseTypes = read('src/types/db.ts');

test('a handle resolved for the session wins over the raw member columns', () => {
  assert.equal(resolveGithubHandle({ github_handle: 'theseifdev', portfolio_url: null, custom_fields: null }), 'theseifdev');
  // الـ handle المحفوظ بيسبق الحقل المخصص القديم عشان تعديل البروفايل يظهر فورًا.
  assert.equal(
    resolveGithubHandle({ github_handle: 'newhandle', portfolio_url: null, custom_fields: { github: 'oldhandle' } }),
    'newhandle',
  );
});

test('the resolver keeps the custom-field and portfolio fallbacks intact', () => {
  assert.equal(resolveGithubHandle({ portfolio_url: null, custom_fields: { 'GitHub username': 'theseifdev' } }), 'theseifdev');
  assert.equal(resolveGithubHandle({ portfolio_url: 'https://github.com/theseifdev', custom_fields: {} }), 'theseifdev');
  assert.equal(resolveGithubHandle({ portfolio_url: 'https://example.com/me', custom_fields: {} }), null);
  assert.equal(resolveGithubHandle({ github_handle: 'not a handle', portfolio_url: null, custom_fields: null }), null);
});

test('the stored handle is checked first inside the resolver source', () => {
  const body = github.slice(github.indexOf('export function resolveGithubHandle'));
  const storedIndex = body.indexOf('normalizeGithubHandle(member.github_handle ?? null)');
  const customIndex = body.indexOf('const fields = member.custom_fields ?? {};');
  assert.ok(storedIndex > 0, 'the resolver must normalise member.github_handle');
  assert.ok(customIndex > storedIndex, 'the stored handle must be evaluated before the custom fields');
});

test('MemberAvatar forwards the session handle into the resolver', () => {
  assert.match(avatar, /github_handle\?: string \| null;/);
  assert.match(avatar, /github_handle: member\.github_handle \?\? null,/);
  assert.match(avatar, /const resolved = handle \?\? \(member/);
});

test('the portal identity hook hydrates the stored member with the GitHub handle', () => {
  assert.match(identityHook, /import \{ useGithubLinkState \} from '\.\.\/members\/github-link-api';/);
  assert.match(identityHook, /useGithubLinkState\(\{ enabled: Boolean\(member\?\.id\) \}\)/);
  assert.match(identityHook, /if \(!member \|\| !handle \|\| member\.github_handle === handle\) return;/);
  assert.match(identityHook, /setMember\(\{ \.\.\.member, github_handle: handle \}\)/);
  assert.match(identityHook, /return handle \?\? member\?\.github_handle \?\? null;/);
});

test('the portal shell and header use the identity hook', () => {
  assert.match(portalLayout, /import \{ useIdentityAvatarHandle \} from '\.\/useIdentityAvatar';/);
  assert.match(portalLayout, /const avatarHandle = useIdentityAvatarHandle\(\);/);
  assert.match(portalLayout, /avatarHandle=\{avatarHandle\}/);
  assert.match(portalHeader, /const avatarHandle = useIdentityAvatarHandle\(\);/);
  assert.match(portalHeader, /handle=\{avatarHandle\}/);
});

test('the sidebar avatar accepts an explicit handle on both surfaces', () => {
  assert.match(sidebar, /avatarHandle\?: string \| null;/);
  const forwards = sidebar.match(/handle=\{avatarHandle\}/g) ?? [];
  assert.equal(forwards.length, 2, 'the rail avatar and the drawer avatar must both use the handle');
});

test('the GitHub link query can be gated for sessions without a member', () => {
  assert.match(githubLinkApi, /export function useGithubLinkState\(options\?: \{ enabled\?: boolean \}\)/);
  assert.match(githubLinkApi, /enabled: options\?\.enabled \?\? true,/);
});

test('the member type carries the session handle without a schema column', () => {
  const memberType = databaseTypes.slice(databaseTypes.indexOf('export type Member = {'), databaseTypes.indexOf('export type MemberInsert'));
  assert.match(memberType, /github_handle\?: string \| null;/);
  assert.match(memberType, /مش عمود في الجدول/);
});
