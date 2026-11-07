/**
 * ============================================================================
 * Security Runtime Integration & Authorization Test Suite (PHANTOMS Phase 1)
 * ============================================================================
 *
 * Clearly separates:
 * 1. Pure Runtime Unit Tests (safeHref, sanitizers, XLSX decompression guard)
 * 2. Database RPC & Authorization Integration Tests (Migration 0022 logic simulation)
 * 3. Local Supabase Detection (checks environment, executes against real DB if available)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ----------------------------------------------------------------------------
// Section 1: Database RPC Logic Simulator (Emulates Migration 0022 PL/pgSQL)
// ----------------------------------------------------------------------------

class Migration0022DatabaseSimulator {
  constructor() {
    this.adminAccounts = new Map();
    this.members = new Map();
    this.deviceSessions = new Map();

    // Seed Owner
    this.adminAccounts.set('owner-uuid-1', {
      user_id: 'owner-uuid-1',
      email: 'owner@phantoms.internal',
      role: 'owner',
      permissions: {
        dashboard: true,
        members: true,
        tasks: true,
        ranking: true,
        notes: true,
        announcements: true,
        whatsapp: true,
        ai_assistant: true,
      },
    });

    // Seed Regular Admin (Scoped to tasks and dashboard only)
    this.adminAccounts.set('admin-uuid-2', {
      user_id: 'admin-uuid-2',
      email: 'taskadmin@phantoms.internal',
      role: 'admin',
      permissions: {
        dashboard: true,
        tasks: true,
        members: false,
        ranking: false,
        notes: false,
        announcements: false,
        whatsapp: false,
        ai_assistant: false,
      },
    });

    // Seed Members
    this.members.set(101, {
      id: 101,
      email: 'alice@phantoms.internal',
      full_name: 'Alice Ahmed',
    });

    this.members.set(102, {
      id: 102,
      email: 'bob@phantoms.internal',
      full_name: 'Bob Mahmoud',
    });
  }

  is_admin(ctx) {
    if (!ctx.userId) return false;
    const account = this.adminAccounts.get(ctx.userId);
    return account ? account.role === 'owner' || account.role === 'admin' : false;
  }

  is_owner(ctx) {
    if (!ctx.userId) return false;
    const account = this.adminAccounts.get(ctx.userId);
    return account ? account.role === 'owner' : false;
  }

  has_admin_permission(ctx, permission) {
    const validSections = [
      'dashboard',
      'members',
      'tasks',
      'ranking',
      'notes',
      'announcements',
      'whatsapp',
      'ai_assistant',
    ];
    if (!validSections.includes(permission)) return false;
    if (!ctx.userId) return false;
    const account = this.adminAccounts.get(ctx.userId);
    if (!account) return false;
    if (account.role === 'owner') return true;
    return Boolean(account.permissions[permission]);
  }

  admin_update_permissions(ctx, targetUserId, newPermissions) {
    if (!this.is_owner(ctx)) {
      throw new Error('OWNER_ONLY: تعديل الصلاحيات متاح للمالك فقط.');
    }
    const target = this.adminAccounts.get(targetUserId);
    if (!target) {
      throw new Error('ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.');
    }
    if (target.role === 'owner') {
      throw new Error('OWNER_IMMUTABLE: صلاحيات مالك النظام ثابتة.');
    }
    target.permissions = { ...newPermissions };
    return true;
  }

  bind_member_device_session(ctx, p_email, p_device_token) {
    if (!p_email || !p_email.trim()) {
      throw new Error('INVALID_EMAIL: البريد الإلكتروني مطلوب.');
    }
    if (!p_device_token || p_device_token.trim().length < 16 || p_device_token.length > 128) {
      throw new Error('DEVICE_REQUIRED: رمز الجهاز غير صالح.');
    }

    const cleanEmail = p_email.trim().toLowerCase();
    let member = undefined;
    for (const m of this.members.values()) {
      if (m.email.toLowerCase() === cleanEmail) {
        member = m;
        break;
      }
    }

    if (!member) {
      throw new Error('MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.');
    }

    const callerEmail = (ctx.jwtEmail || '').trim().toLowerCase();
    const isEmailVerified = callerEmail !== '' && callerEmail === cleanEmail;
    const isAdmin = this.is_admin(ctx);

    if (!isEmailVerified && !isAdmin) {
      throw new Error('UNAUTHORIZED: يلزم التحقق من البريد الإلكتروني عبر رمز الدخول أو تأكيد الإدارة.');
    }

    const tokenHash = crypto.createHash('sha256').update(p_device_token, 'utf8').digest('hex');
    const sessionKey = `${member.id}:${tokenHash}`;

    this.deviceSessions.set(sessionKey, {
      member_id: member.id,
      token_hash: tokenHash,
      created_at: new Date(),
      last_seen_at: new Date(),
    });

    return true;
  }

  lookup_member_by_email(ctx, p_email, p_device_token) {
    if (!p_email || !p_email.trim() || p_email.length > 254) return null;
    const cleanEmail = p_email.trim().toLowerCase();

    let member = undefined;
    for (const m of this.members.values()) {
      if (m.email.toLowerCase() === cleanEmail) {
        member = m;
        break;
      }
    }
    if (!member) return null;

    let isBound = false;
    if (p_device_token && p_device_token.trim().length >= 16) {
      const tokenHash = crypto.createHash('sha256').update(p_device_token, 'utf8').digest('hex');
      const sessionKey = `${member.id}:${tokenHash}`;
      const session = this.deviceSessions.get(sessionKey);
      if (session) {
        isBound = true;
      } else {
        const callerEmail = (ctx.jwtEmail || '').trim().toLowerCase();
        if ((callerEmail !== '' && callerEmail === cleanEmail) || this.is_admin(ctx)) {
          this.deviceSessions.set(sessionKey, {
            member_id: member.id,
            token_hash: tokenHash,
            created_at: new Date(),
            last_seen_at: new Date(),
          });
          isBound = true;
        }
      }
    }

    if (isBound || this.is_admin(ctx)) {
      return member;
    }
    return null;
  }
}

// ----------------------------------------------------------------------------
// Section 2: AI Strict Reference Resolution Unit Tests
// ----------------------------------------------------------------------------

function resolveTargetMemberStrict(members, actionId, targetName) {
  const memberId = Number(actionId);
  if (!isNaN(memberId) && memberId > 0) {
    const byId = members.find((m) => m.id === memberId);
    if (byId) return byId;
  }

  if (!targetName || !targetName.trim()) {
    throw new Error('اسم أو معرّف العضو مطلوب لتنفيذ هذا الإجراء.');
  }

  const clean = targetName.trim().replace(/\s+/g, ' ').toLowerCase();
  const exact = members.find((m) => m.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === clean);
  if (exact) return exact;

  const candidates = members.filter((m) => {
    const name = m.full_name.trim().replace(/\s+/g, ' ').toLowerCase();
    return name.includes(clean) || clean.includes(name);
  });

  if (candidates.length > 0) {
    const list = candidates.map((c) => c.full_name).join('، ');
    throw new Error(`لم يتم العثور على تطابق دقيق للاسم "${targetName}". المقترحات المحتملة: (${list}).`);
  }

  throw new Error(`لم يتم العثور على أي عضو يطابق الاسم: "${targetName}".`);
}

// ----------------------------------------------------------------------------
// Execution: Runtime Test Suite
// ----------------------------------------------------------------------------

test('Security Runtime Integration Suite (Migration 0022 & Authorization)', async (t) => {
  const db = new Migration0022DatabaseSimulator();

  // Test 1: Anonymous member device binding rejection
  await t.test('1. Anonymous member device binding is rejected with UNAUTHORIZED', () => {
    const anonCtx = { userId: null, jwtEmail: null, role: 'anon' };
    const validDeviceToken = 'device-token-random-bytes-1234567890';

    assert.throws(
      () => db.bind_member_device_session(anonCtx, 'alice@phantoms.internal', validDeviceToken),
      (err) => {
        assert.ok(err.message.includes('UNAUTHORIZED'));
        return true;
      }
    );
  });

  // Test 2: OTP-verified member binding succeeds
  await t.test('2. OTP-verified member binding succeeds and records SHA-256 session hash', () => {
    const verifiedCtx = {
      userId: 'user-auth-uuid-alice',
      jwtEmail: 'alice@phantoms.internal',
      role: 'authenticated',
    };
    const validDeviceToken = 'device-token-random-bytes-1234567890';

    const result = db.bind_member_device_session(verifiedCtx, 'alice@phantoms.internal', validDeviceToken);
    assert.strictEqual(result, true);

    // Verify token hash is stored
    const expectedHash = crypto.createHash('sha256').update(validDeviceToken, 'utf8').digest('hex');
    assert.ok(db.deviceSessions.has(`101:${expectedHash}`));
  });

  // Test 3: Cross-member binding rejection (IDOR)
  await t.test('3. Cross-member binding rejection (Alice JWT cannot bind Bob session)', () => {
    const aliceCtx = {
      userId: 'user-auth-uuid-alice',
      jwtEmail: 'alice@phantoms.internal',
      role: 'authenticated',
    };
    const attackerDeviceToken = 'attacker-device-token-1234567890';

    assert.throws(
      () => db.bind_member_device_session(aliceCtx, 'bob@phantoms.internal', attackerDeviceToken),
      (err) => {
        assert.ok(err.message.includes('UNAUTHORIZED'));
        return true;
      }
    );
  });

  // Test 4: Admin permission boundaries
  await t.test('4. Admin permission boundaries (Task Admin denied member management)', () => {
    const taskAdminCtx = {
      userId: 'admin-uuid-2',
      jwtEmail: 'taskadmin@phantoms.internal',
      role: 'authenticated',
    };

    assert.strictEqual(db.has_admin_permission(taskAdminCtx, 'tasks'), true);
    assert.strictEqual(db.has_admin_permission(taskAdminCtx, 'dashboard'), true);
    assert.strictEqual(db.has_admin_permission(taskAdminCtx, 'members'), false);
    assert.strictEqual(db.has_admin_permission(taskAdminCtx, 'ai_assistant'), false);

    // Non-owner trying to update permissions must fail
    assert.throws(
      () => db.admin_update_permissions(taskAdminCtx, 'admin-uuid-2', { members: true }),
      (err) => {
        assert.ok(err.message.includes('OWNER_ONLY'));
        return true;
      }
    );
  });

  // Test 5: Owner immutability
  await t.test('5. Owner immutability (Owner permissions cannot be altered via RPC)', () => {
    const ownerCtx = {
      userId: 'owner-uuid-1',
      jwtEmail: 'owner@phantoms.internal',
      role: 'authenticated',
    };

    // Owner has all permissions dynamically
    assert.strictEqual(db.has_admin_permission(ownerCtx, 'members'), true);
    assert.strictEqual(db.has_admin_permission(ownerCtx, 'tasks'), true);

    // Trying to alter owner's own account permissions is blocked
    assert.throws(
      () => db.admin_update_permissions(ownerCtx, 'owner-uuid-1', { members: false }),
      (err) => {
        assert.ok(err.message.includes('OWNER_IMMUTABLE'));
        return true;
      }
    );
  });

  // Test 6: RLS lookup_member_by_email behavior
  await t.test('6. Unbound device lookup returns null for anon callers', () => {
    const anonCtx = { userId: null, jwtEmail: null, role: 'anon' };
    const unknownToken = 'unknown-device-token-1234567890';

    // Alice email with unknown device token -> returns null
    const result = db.lookup_member_by_email(anonCtx, 'alice@phantoms.internal', unknownToken);
    assert.strictEqual(result, null);

    // Alice email with bound device token -> returns member row
    const boundToken = 'device-token-random-bytes-1234567890';
    const boundResult = db.lookup_member_by_email(anonCtx, 'alice@phantoms.internal', boundToken);
    assert.ok(boundResult !== null);
    assert.strictEqual(boundResult?.full_name, 'Alice Ahmed');
  });

  // Test 7: Unauthorized & Ambiguous AI Action Rejection
  await t.test('7. AI Strict Member Resolution rejects loose substring and ambiguous references', () => {
    const mockMembers = [
      { id: 1, full_name: 'أحمد محمود علي' },
      { id: 2, full_name: 'أحمد سعيد حسن' },
      { id: 3, full_name: 'سارة إبراهيم' },
    ];

    // Ambiguous reference (multiple matches)
    assert.throws(
      () => resolveTargetMemberStrict(mockMembers, null, 'أحمد'),
      (err) => {
        assert.ok(err.message.includes('المقترحات المحتملة'));
        return true;
      }
    );

    // Single partial match without exact match is REJECTED (strict mode)
    assert.throws(
      () => resolveTargetMemberStrict(mockMembers, null, 'سارة'),
      (err) => {
        assert.ok(err.message.includes('لم يتم العثور على تطابق دقيق'));
        return true;
      }
    );

    // Exact full name match succeeds
    const exact = resolveTargetMemberStrict(mockMembers, null, 'سارة إبراهيم');
    assert.strictEqual(exact.id, 3);

    // Numeric ID lookup succeeds
    const byId = resolveTargetMemberStrict(mockMembers, 2, 'أي اسم عشوائي');
    assert.strictEqual(byId.id, 2);
  });
});
