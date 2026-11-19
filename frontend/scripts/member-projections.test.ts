import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_MEMBER_COLUMNS, PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS } from '../src/features/members/memberColumns.ts';
import { toAppError } from '../src/lib/supabase/errors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..');
const readSource = (relativePath: string) => readFileSync(path.join(FRONTEND, relativePath), 'utf8');
const api = readSource('src/features/members/api.ts');
const inviteApi = readSource('src/features/members/memberInviteApi.ts');
const inviteModal = readSource('src/features/members/MemberInviteModal.tsx');
const reviewQueue = readSource('src/features/members/MemberJoinReviewQueue.tsx');
const memberSelfRegister = readSource('src/features/members/MemberSelfRegisterPage.tsx');
const joinReviewMigration = readSource('../backend/supabase/migrations/20261119005000_member_password_owner_join_review.sql');

const ADMIN_COLUMNS = [
  'id', 'created_at', 'email', 'full_name', 'completion_rank', 'team_notes',
  'residence', 'work_conditions', 'bio', 'phone', 'device', 'gender',
  'meeting_attendance', 'work_status', 'can_go_alexandria', 'bonus_infinite', 'custom_fields',
];
const PUBLIC_PROJECTION =
  'id, created_at, email, full_name, completion_rank, bio, device, meeting_attendance, work_status, can_go_alexandria';

function projectionLiteral(source: string, constantName: string) {
  const match = source.match(new RegExp(`${constantName}\\s*=\\s*['"]([^'"]+)['"]`));
  assert.ok(match, `${constantName} literal was not found`);
  return match[1];
}

test('actual exported administrator projection contains exactly the 17 safe columns', () => {
  assert.equal(ADMIN_MEMBER_COLUMNS, ADMIN_COLUMNS.join(','));
  assert.deepEqual(ADMIN_MEMBER_COLUMNS.split(','), ADMIN_COLUMNS);
  assert.equal(new Set(ADMIN_MEMBER_COLUMNS.split(',')).size, 17);
  assert.doesNotMatch(ADMIN_MEMBER_COLUMNS, /session_token|push_subscription/);
  assert.match(api, /export \{ ADMIN_MEMBER_COLUMNS \} from '\.\/memberColumns'/);
});

test('the pre-custom-fields projection omits only the unavailable column and remains secret-free', () => {
  assert.deepEqual(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS.split(','), ADMIN_COLUMNS.filter((column) => column !== 'custom_fields'));
  assert.equal(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS.split(',').length, 16);
  assert.doesNotMatch(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS, /session_token|push_subscription|custom_fields/);
});

test('the restricted public member projection remains unchanged', () => {
  assert.equal(projectionLiteral(api, 'PUBLIC_MEMBER_COLUMNS'), PUBLIC_PROJECTION);
  assert.match(api, /\.select\(PUBLIC_MEMBER_COLUMNS\)/);
});

test('authenticated member list uses explicit projection and no wildcard result selections remain', () => {
  assert.match(api, /if \(sessionData\.session\)[\s\S]*?\.select\(ADMIN_MEMBER_COLUMNS\)\.order\('full_name'/);
  for (const source of [api, inviteApi]) {
    assert.doesNotMatch(source, /\.select\(\s*['"]\*['"]\s*\)|\.select\(\s*\)/);
  }
});

test('member create/update/upsert primary responses and existing fallback responses remain explicit', () => {
  assert.equal((api.match(/\.select\(ADMIN_MEMBER_COLUMNS\)/g) ?? []).length, 4);
  assert.equal((api.match(/\.select\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\)/g) ?? []).length, 3);
  for (const operation of ['insert', 'update', 'upsert']) {
    assert.match(api, new RegExp(`\\.${operation}\\([\\s\\S]*?\\.select\\(ADMIN_MEMBER_COLUMNS\\)`));
  }
  for (const [operation, payload] of [['insert', 'fallbackPayload'], ['update', 'fallbackPayload'], ['upsert', 'fallbackRows']]) {
    assert.match(api, new RegExp(`if \\(isMissingCustomFieldsColumnError\\(error\\)\\)[\\s\\S]*?\\.${operation}\\(${payload}[\\s\\S]*?\\.select\\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\\)`));
  }
});

test('invitation registration has no browser member writes or legacy fallback authority and keeps an explicit safe bounded projection', () => {
  assert.doesNotMatch(inviteApi, /\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(inviteApi, /packTeamNotesWithCustomFields|updateBody|register_member_with_invite|create_member_invite/);
  assert.match(inviteApi, /\.select\('id, email, full_name, work_status'\)\.eq\('work_status', 'active'\)/);
  assert.match(inviteApi, /\.limit\(500\)/);
  assert.match(inviteApi, /member-password-enrollment/);
  assert.doesNotMatch(readSource('src/features/members/MemberSelfRegisterPage.tsx'), /\.(?:insert|update|upsert|delete|signUp)\s*\(/);
});

test('Admin and member self-service screens expose links only, with no separate manual invitation-code channel', () => {
  assert.match(inviteModal, /createdInvite\.url/);
  assert.doesNotMatch(inviteModal, /createdInvite\.token|عرض الكود اليدوي|نسخ الكود اليدوي/);
  assert.doesNotMatch(inviteApi, /expectedAuthUserId|associationEvidence/);
  const createdInviteInterface = inviteApi.match(/export interface CreatedMemberInvite[\s\S]*?\n}/)?.[0] ?? '';
  assert.ok(createdInviteInterface);
  assert.doesNotMatch(createdInviteInterface, /token/);
  assert.doesNotMatch(memberSelfRegister, /id="join-token"|أدخل الكود يدوياً|أدخل رمز الدعوة/);
});

test('Admin join form has no email field, always issues an unbound link, and keeps recipient email required', () => {
  const joinOptionsStart = inviteModal.indexOf('<div data-testid="member-invite-join-options"');
  assert.notEqual(joinOptionsStart, -1);
  const joinOptionsEnd = inviteModal.indexOf('</div>', joinOptionsStart);
  assert.notEqual(joinOptionsEnd, -1);
  const joinOptions = inviteModal.slice(joinOptionsStart, joinOptionsEnd);
  assert.doesNotMatch(joinOptions, /member-invite-email|type="email"/);
  assert.match(joinOptions, /اسم الطالب في رسالة واتساب \(اختياري\)/);
  assert.doesNotMatch(joinOptions, /required/);
  assert.match(inviteModal, /email: isNewMember \? null : email\.trim\(\)/);
  assert.match(inviteModal, /ده رابط الدعوة لمنصة PHANTOMS/);
  assert.match(inviteModal, /نسخ رابط الدعوة/);
  assert.match(inviteModal, /نسخ الدعوة في رسالة واتساب/);
  assert.match(inviteModal, /id="member-invite-whatsapp-preview"[^>]*readOnly/);
  assert.match(inviteModal, /document\.execCommand\('copy'\)/);
  assert.doesNotMatch(inviteModal, /ملاحظة داخلية|setNote|\n\s*note,/);
  assert.doesNotMatch(inviteModal, /value=\{note\}|onChange=\{\(event\) => setNote/);
  const issuePayload = inviteModal.match(/createInvite\.mutateAsync\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
  assert.ok(issuePayload);
  assert.doesNotMatch(issuePayload, /whatsAppName|messageName|studentName/);
  assert.match(inviteApi, /interface IssueInput[\s\S]*?email: string \| null/);
  assert.match(inviteApi, /input\.purpose === 'join'[\s\S]*?email === null/);
  assert.match(memberSelfRegister, /id="join-email" type="email"[^>]*required/);
});

test('owner join-review queue uses the guarded Edge actions, displays submitted data, confirms activation, and refreshes member state', () => {
  assert.match(inviteApi, /action: 'list_join_reviews'/);
  assert.match(inviteApi, /useInfiniteQuery/);
  assert.match(inviteApi, /getNextPageParam/);
  assert.match(inviteApi, /MEMBER_JOIN_REVIEW_PAGE_SIZE = 100/);
  assert.match(inviteApi, /cursor: pageParam/);
  assert.match(inviteApi, /action: 'approve_join', memberId/);
  assert.match(inviteApi, /MEMBER_JOIN_REVIEWS_KEY/);
  assert.match(inviteApi, /invalidateQueries\(\{ queryKey: MEMBER_JOIN_REVIEWS_KEY \}\)/);
  assert.match(inviteApi, /invalidateQueries\(\{ queryKey: \['members'\] \}\)/);
  assert.match(reviewQueue, /data-testid="member-join-review-queue"/);
  assert.match(reviewQueue, /review\.fullName[\s\S]*?review\.email[\s\S]*?review\.phone[\s\S]*?review\.residence[\s\S]*?review\.bio/);
  assert.match(reviewQueue, /member-join-review-email-mismatch/);
  assert.match(reviewQueue, /disabled=\{approve\.isPending \|\| !review\.emailIdentityMatches\}/);
  assert.match(reviewQueue, /عرض الطلبات الأقدم/);
  assert.match(reviewQueue, /description="[^"]*سيتم تسجيل قرار المراجعة/);
  assert.match(reviewQueue, /confirmLabel="موافقة وتفعيل"/);
  assert.doesNotMatch(`${inviteApi}\n${reviewQueue}`, /\.from\(['"]members['"]\)\.(?:update|insert)\s*\(/);
  assert.match(memberSelfRegister, /بعد حفظ تسجيلك بنجاح سيظهر طلبك للإدارة/);
  assert.match(readSource('src/features/members/MembersPage.tsx'), /<MemberJoinReviewQueue\s*\/>/);
  assert.match(joinReviewMigration, /CREATE OR REPLACE FUNCTION public\.member_password_list_join_reviews[\s\S]*?SECURITY DEFINER SET search_path = ''/);
  assert.match(joinReviewMigration, /CREATE OR REPLACE FUNCTION public\.member_password_approve_join[\s\S]*?SECURITY DEFINER SET search_path = ''/);
  assert.match(joinReviewMigration, /REVOKE ALL ON FUNCTION public\.member_password_list_join_reviews\(UUID, TIMESTAMPTZ, BIGINT, UUID\) FROM PUBLIC, anon, authenticated;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.member_password_list_join_reviews\(UUID, TIMESTAMPTZ, BIGINT, UUID\) TO service_role/);
  assert.match(joinReviewMigration, /REVOKE ALL ON FUNCTION public\.member_password_approve_join\(BIGINT, UUID\) FROM PUBLIC, anon, authenticated;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.member_password_approve_join\(BIGINT, UUID\) TO service_role/);
  assert.match(joinReviewMigration, /auth\.role\(\) IS DISTINCT FROM 'service_role'[\s\S]*?RAISE EXCEPTION 'JOIN_REVIEW_REQUIRED'/);
  const activationGuard = joinReviewMigration.match(/FUNCTION public\.guard_pending_member_join_activation[\s\S]*?\$\$;[\s\S]*?CREATE TRIGGER/)?.[0] ?? '';
  assert.ok(activationGuard);
  assert.match(activationGuard, /NEW\.work_status IS DISTINCT FROM 'inactive'/);
  assert.doesNotMatch(activationGuard, /COALESCE\(OLD\.work_status, ''\)\s*=\s*'inactive'/);
  const listFunction = joinReviewMigration.match(/FUNCTION public\.member_password_list_join_reviews[\s\S]*?\$\$;[\s\S]*?REVOKE ALL/)?.[0] ?? '';
  assert.ok(listFunction);
  const exposedFields = listFunction.match(/jsonb_build_object\(([\s\S]*?)\) ORDER BY/)?.[1] ?? '';
  assert.ok(exposedFields);
  assert.doesNotMatch(exposedFields, /token_hash|expected_auth_user_id|auth_user_id/);
  assert.match(exposedFields, /invitation_email/);
  assert.match(exposedFields, /email_identity_matches/);
  assert.match(listFunction, /i\.normalized_email = b\.normalized_email/);
  assert.match(listFunction, /b\.normalized_email = pg_catalog\.lower\(pg_catalog\.btrim\(COALESCE\(recipient\.email, ''\)\)\)/);
  assert.match(listFunction, /LIMIT 100/);
  assert.match(listFunction, /\(i\.completed_at, m\.id, i\.id\) < \(p_before_submitted_at, p_before_member_id, p_before_invitation_id\)/);
  assert.match(joinReviewMigration, /b\.normalized_email = v_invitation\.normalized_email[\s\S]*?FOR UPDATE OF b, recipient/);
});

test('generic member activation guard gives the Admin an actionable review-queue message', () => {
  const error = toAppError({ message: 'JOIN_REVIEW_REQUIRED' }, 'fallback');
  assert.equal(error.message, 'التسجيل ده لسه محتاج مراجعة. استخدم قائمة مراجعة تسجيلات الأعضاء الجدد للموافقة والتفعيل.');
});

test('member result selections exclude secrets while write-field protections remain intact', () => {
  assert.doesNotMatch(`${api}\n${inviteApi}`, /\.select\([^)]*(?:session_token|push_subscription)/);
  assert.match(api, /MEMBER_WRITABLE_FIELDS/);
  assert.match(api, /session_token: _st, push_subscription: _ps/);
});
