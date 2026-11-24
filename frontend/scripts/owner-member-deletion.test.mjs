import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class FakeClock {
  now = 0;
  nextId = 1;
  timers = new Map();

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + delay });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  async advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, left], [, right]) => left.at - right.at);
      if (!due.length) break;
      const [id, timer] = due[0];
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.now = target;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const apiSource = readFileSync(path.join(frontend, 'src/features/members/api.ts'), 'utf8');

const clock = new FakeClock();
globalThis.window = {
  setTimeout: clock.setTimeout.bind(clock),
  clearTimeout: clock.clearTimeout.bind(clock),
};

const {
  MemberDeletionError,
  assertMemberDeletionResult,
  classifyMemberDeletionError,
} = await import('../src/features/members/member-delete-errors.ts');
const { useMemberDeletionStore } = await import('../src/store/memberDeletion.ts');
const { useToastStore } = await import('../src/store/toast.ts');

const member = {
  id: 42,
  created_at: '2026-01-01T00:00:00.000Z',
  email: 'member@example.test',
  full_name: 'Test Member',
  completion_rank: null,
  team_notes: null,
  residence: null,
  work_conditions: null,
  bio: null,
  phone: null,
  device: null,
  gender: null,
  meeting_attendance: null,
  work_status: 'active',
  can_go_alexandria: false,
  bonus_infinite: false,
};

function resetState() {
  useMemberDeletionStore.getState().clearAll();
  useToastStore.setState({ toasts: [] });
}

function latestToast(kind) {
  return [...useToastStore.getState().toasts].reverse().find((toast) => toast.kind === kind);
}

test('DELETE success requires one matching returned id; zero and mismatched rows reject', () => {
  assert.deepEqual(assertMemberDeletionResult(42, [{ id: 42 }]), { id: 42, deletedCount: 1 });

  assert.throws(
    () => assertMemberDeletionResult(42, []),
    (error) => error instanceof MemberDeletionError && error.code === 'member_delete_no_match',
  );
  assert.throws(
    () => assertMemberDeletionResult(42, [{ id: 41 }]),
    (error) => error instanceof MemberDeletionError && error.code === 'member_delete_no_match',
  );

  const provider = {
    code: '23503',
    message: 'Key (member_id)=(42) is still referenced by member_password_invitations for private@example.test',
  };
  assert.throws(
    () => assertMemberDeletionResult(42, null, provider),
    (error) => {
      assert.equal(error.code, 'member_delete_dependency_invitations');
      assert.doesNotMatch(error.message, /private@example\.test|23503|member_password_invitations/);
      return true;
    },
  );
});

test('provider dependency, permission, missing-schema, and unknown failures stay distinct', () => {
  assert.equal(classifyMemberDeletionError({ code: '23503', message: 'team_memberships member_id foreign key' }), 'member_delete_dependency_team');
  assert.equal(classifyMemberDeletionError({ code: '23503', message: 'web_projects submitted_by_member_id foreign key' }), 'member_delete_dependency_projects');
  assert.equal(classifyMemberDeletionError({ code: '42501', message: 'new row violates row-level security policy' }), 'member_delete_permission');
  assert.equal(classifyMemberDeletionError({ code: '42P01', message: 'relation public.members does not exist' }), 'member_delete_missing_schema');
  assert.equal(classifyMemberDeletionError({ code: 'PGRST205', message: 'Could not find the table in the schema cache' }), 'member_delete_missing_schema');
  assert.equal(classifyMemberDeletionError({ code: 'XX000', message: 'provider incident' }), 'member_delete_unknown');
});

test('the mutation selects only id and delegates positive completion to the assertion helper', () => {
  assert.match(apiSource, /\.from\(TABLES\.members\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\('id', id\)[\s\S]*?\.select\('id'\)/);
  assert.match(apiSource, /return assertMemberDeletionResult\(id, data, error\)/);
  assert.doesNotMatch(apiSource, /\.delete\(\)\.eq\('id', id\);/);
});

test('scheduled deletion does not invoke the server before five seconds and undo cancels it', async () => {
  resetState();
  let calls = 0;
  useMemberDeletionStore.getState().scheduleDelete(member, async () => {
    calls += 1;
  }, 5000);

  assert.equal(calls, 0);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), true);
  assert.equal(latestToast('info')?.message.includes('الحذف متحدد'), true);

  await clock.advance(4999);
  assert.equal(calls, 0);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), true);

  assert.equal(useMemberDeletionStore.getState().undoDelete(member.id), true);
  await clock.advance(1);
  assert.equal(calls, 0);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
});

test('a stale Undo toast cannot cancel a replacement queue for the same member', async () => {
  resetState();
  let calls = 0;
  const commit = async () => { calls += 1; };

  useMemberDeletionStore.getState().scheduleDelete({ ...member, full_name: 'Member A' }, commit, 5000);
  const memberAUndo = latestToast('info')?.action?.onClick;
  assert.equal(typeof memberAUndo, 'function');

  useMemberDeletionStore.getState().scheduleDelete({ ...member, full_name: 'Member B' }, commit, 5000);
  memberAUndo();

  assert.equal(useMemberDeletionStore.getState().pendingMap[member.id].member.full_name, 'Member B');
  assert.equal(useMemberDeletionStore.getState().pendingMap[member.id].phase, 'queued');
  await clock.advance(4999);
  assert.equal(calls, 0);
  assert.equal(useMemberDeletionStore.getState().pendingMap[member.id].phase, 'queued');

  await clock.advance(1);
  assert.equal(calls, 1);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
});

test('an Undo captured before completion cannot cancel a later queue for the same member', async () => {
  resetState();
  let calls = 0;
  const commit = async () => { calls += 1; };

  useMemberDeletionStore.getState().scheduleDelete({ ...member, full_name: 'Member A' }, commit, 5000);
  const memberAUndo = latestToast('info')?.action?.onClick;
  assert.equal(typeof memberAUndo, 'function');
  await clock.advance(5000);
  assert.equal(calls, 1);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);

  useMemberDeletionStore.getState().scheduleDelete({ ...member, full_name: 'Member B' }, commit, 5000);
  memberAUndo();
  assert.equal(useMemberDeletionStore.getState().pendingMap[member.id].member.full_name, 'Member B');
  assert.equal(useMemberDeletionStore.getState().pendingMap[member.id].phase, 'queued');

  await clock.advance(5000);
  assert.equal(calls, 2);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
});

test('pending visibility clears only after post-server success', async () => {
  resetState();
  let calls = 0;
  useMemberDeletionStore.getState().scheduleDelete(member, async (id) => {
    calls += 1;
    return { id, deletedCount: 1 };
  }, 5000);

  await clock.advance(4999);
  assert.equal(calls, 0);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), true);
  assert.equal(latestToast('success'), undefined);

  await clock.advance(1);
  assert.equal(calls, 1);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
  assert.match(latestToast('success')?.message ?? '', /تم حذف سجل العضو بعد تأكيد الخادم/);
  assert.match(latestToast('success')?.message ?? '', /مش حذف حساب الدخول/);
});

test('server rejection restores visibility and gives an actionable typed reason', async () => {
  resetState();
  let callbackCode;
  const rawProviderMessage = '23503 private@example.test member_id team_memberships';
  useMemberDeletionStore.getState().scheduleDelete(member, async () => {
    throw new MemberDeletionError('member_delete_dependency_team');
  }, 5000, (error) => {
    callbackCode = error.code;
  });

  await clock.advance(5000);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
  assert.equal(callbackCode, 'member_delete_dependency_team');
  const errorToast = latestToast('error');
  assert.match(errorToast?.message ?? '', /عضوية فريق/);
  assert.doesNotMatch(errorToast?.message ?? '', /23503|private@example\.test|team_memberships/);
  assert.equal(rawProviderMessage.includes(errorToast?.message ?? ''), false);
});

test('invitation FK rejection preserves the record and explains the safe next step without provider details', async () => {
  resetState();
  useMemberDeletionStore.getState().scheduleDelete(member, async () => {
    throw new MemberDeletionError('member_delete_dependency_invitations');
  }, 5000);

  await clock.advance(5000);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
  const errorToast = latestToast('error');
  assert.match(errorToast?.message ?? '', /دعوة محفوظة ما زالت مرتبطة/);
  assert.match(errorToast?.message ?? '', /لم يُحذف سجل العضو/);
  assert.match(errorToast?.message ?? '', /لا تحذفها يدويًا/);
  assert.doesNotMatch(errorToast?.message ?? '', /member_password_invitations|23503|private@example\.test/);
  assert.equal(latestToast('success'), undefined);
});

test('invitation FK rejection preserves the record and explains the safe next step without provider details', async () => {
  resetState();
  useMemberDeletionStore.getState().scheduleDelete(member, async () => {
    throw new MemberDeletionError('member_delete_dependency_invitations');
  }, 5000);

  await clock.advance(5000);
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
  const errorToast = latestToast('error');
  assert.match(errorToast?.message ?? '', /دعوة محفوظة ما زالت مرتبطة/);
  assert.match(errorToast?.message ?? '', /لم يُحذف سجل العضو/);
  assert.match(errorToast?.message ?? '', /لا تحذفها يدويًا/);
  assert.doesNotMatch(errorToast?.message ?? '', /member_password_invitations|23503|private@example\.test/);
  assert.equal(latestToast('success'), undefined);
});

test('in-flight request cannot be undone or duplicated; success waits for its response', async () => {
  resetState();
  let finish, calls = 0;
  const response = new Promise((resolve) => { finish = resolve; });
  const commit = async () => { calls++; return response; };
  useMemberDeletionStore.getState().scheduleDelete(member, commit, 5000);
  await clock.advance(5000);
  assert.equal(calls, 1);
  assert.equal(useMemberDeletionStore.getState().pendingMap[member.id].phase, 'committing');
  assert.equal(useMemberDeletionStore.getState().undoDelete(member.id), false);
  useMemberDeletionStore.getState().scheduleDelete(member, commit, 5000);
  await clock.advance(5000);
  assert.equal(calls, 1); assert.equal(latestToast('success'), undefined);
  finish({ id: member.id, deletedCount: 1 });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(useMemberDeletionStore.getState().isPendingDelete(member.id), false);
  assert.ok(latestToast('success'));
});

test('uncertain transport failure never claims the server did not delete the row', async () => {
  resetState();
  useMemberDeletionStore.getState().scheduleDelete(member, async () => { throw new Error('private transport detail'); }, 5000);
  await clock.advance(5000);
  assert.match(latestToast('error')?.message ?? '', /تعذّر تأكيد نتيجة الحذف/);
  assert.doesNotMatch(latestToast('error')?.message ?? '', /ما اتحذفش|private transport detail/);
  assert.equal(latestToast('success'), undefined);
});

test('legacy member deletion is labeled as profile-row-only, not full account erasure', () => {
  const membersPage = readFileSync(path.join(frontend, 'src/features/members/MembersPage.tsx'), 'utf8');
  const memberCards = readFileSync(path.join(frontend, 'src/features/members/MemberCards.tsx'), 'utf8');
  const toolbar = readFileSync(path.join(frontend, 'src/features/members/MemberToolbar.tsx'), 'utf8');
  const profileModal = readFileSync(path.join(frontend, 'src/features/members/MemberProfileModal.tsx'), 'utf8');
  assert.ok(membersPage.includes("title={t('تأكيد حذف سجل العضو'"));
  assert.ok(membersPage.includes("t('حذف سجل العضو فقط', 'Delete profile record only')"));
  assert.ok(membersPage.includes("t('حذف نهائي', 'Delete permanently')"));
  assert.ok(membersPage.includes('useOwnerDeleteMember'));
  assert.ok(membersPage.includes('isOwner ? ownerRemove.mutateAsync : remove.mutateAsync'));
  assert.ok(membersPage.includes('هذا لا يحذف حساب تسجيل الدخول ولا يلغي Admin.'));
  assert.ok(membersPage.includes('الحذف العادي موقوف لحفظ سجل الدعوات'));
  assert.ok(membersPage.includes('افتح معاينة المالك الآمنة'));
  assert.ok(membersPage.includes("member-owner-actions-${memberId}"));
  assert.ok(membersPage.includes('memberMetrics.incomplete'));
  assert.ok(toolbar.includes('academic number, group, or specialization'));
  assert.ok(toolbar.includes('value.information'));
  assert.ok(memberCards.includes("title={t('حذف سجل العضو فقط'"));
  assert.ok(memberCards.includes('id={`member-owner-actions-${member.id}`}'));
  assert.ok(profileModal.includes("t('حذف سجل العضو فقط', 'Delete profile record only')"));
  assert.doesNotMatch(membersPage, /member_password_invitations|23503|private@example\.test/);
  const membersApi = readFileSync(path.join(frontend, 'src/features/members/api.ts'), 'utf8');
  assert.ok(membersApi.includes("'owner_delete_member'"));
  assert.ok(membersApi.includes('p_member_id: id'));
});
