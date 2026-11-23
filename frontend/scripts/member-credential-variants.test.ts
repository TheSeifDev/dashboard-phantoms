import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanCredentialText,
  MAX_PASSWORD_VARIANTS,
  passwordVariants,
  signInWithPasswordVariants,
} from '../src/features/auth/member-credential-variants';

const invalidCredentials = { message: 'Invalid login credentials', status: 400 };
const networkFailure = { message: 'Failed to fetch', status: 0 };

test('passwordVariants: الشكل الأصلي دايمًا الأول ومن غير تغيير', () => {
  assert.deepEqual(passwordVariants('SecretPassword123'), ['SecretPassword123']);
  assert.equal(passwordVariants('SecretPassword123')[0], 'SecretPassword123');
});

test('passwordVariants: بيضيف النسخة بدون مسافات طرفية', () => {
  const variants = passwordVariants('  SecretPassword123  ');
  assert.equal(variants[0], '  SecretPassword123  ');
  assert.equal(variants[1], 'SecretPassword123');
});

test('passwordVariants: بيطبّع الحروف المتراكبة لـ NFC (فرق iOS وأندرويد)', () => {
  const nfc = 'Caf\u00e9123456789';
  const nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd);
  assert.ok(passwordVariants(nfd).includes(nfc));
  assert.equal(passwordVariants(nfd)[0], nfd);
});

test('passwordVariants: مفيش تكرار وأقصى عدد محدود', () => {
  const variants = passwordVariants(' SameValue123 ');
  assert.equal(new Set(variants).size, variants.length);
  assert.ok(variants.length <= MAX_PASSWORD_VARIANTS);
  assert.deepEqual(passwordVariants(''), []);
});

test('signInWithPasswordVariants: بينجح من أول محاولة من غير أي إعادة', async () => {
  const attempted: string[] = [];
  const result = await signInWithPasswordVariants({
    email: 'member@phantoms.test',
    password: 'SecretPassword123',
    signIn: async ({ password }) => {
      attempted.push(password);
      return { data: { user: { id: 'user-1' } }, error: null };
    },
  });
  assert.deepEqual(attempted, ['SecretPassword123']);
  assert.equal(result.attempts, 1);
  assert.equal(result.normalized, false);
  assert.deepEqual(result.result, { data: { user: { id: 'user-1' } }, error: null });
  assert.equal(result.error, null);
});

test('signInWithPasswordVariants: مسافة آخر الكلمة من كيبورد الموبايل بتتصلح تلقائيًا', async () => {
  const attempted: string[] = [];
  const result = await signInWithPasswordVariants({
    email: 'member@phantoms.test',
    password: 'SecretPassword123 ',
    signIn: async ({ password }) => {
      attempted.push(password);
      return password === 'SecretPassword123'
        ? { data: { user: { id: 'user-1' } }, error: null }
        : { data: null, error: invalidCredentials };
    },
  });
  assert.deepEqual(attempted, ['SecretPassword123 ', 'SecretPassword123']);
  assert.equal(result.attempts, 2);
  assert.equal(result.normalized, true);
  assert.ok(result.result);
});

test('signInWithPasswordVariants: أي خطأ شبكة بيوقف المحاولات فورًا', async () => {
  const attempted: string[] = [];
  const result = await signInWithPasswordVariants({
    email: 'member@phantoms.test',
    password: ' SecretPassword123 ',
    signIn: async ({ password }) => {
      attempted.push(password);
      return { data: null, error: networkFailure };
    },
  });
  assert.equal(attempted.length, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.error, networkFailure);
  assert.equal(result.result, null);
});

test('signInWithPasswordVariants: كلمة مرور غلط فعلًا بترجع آخر خطأ بعد كل الأشكال', async () => {
  const raw = ` ${'P\u00e4ssword123'.normalize('NFD')} `;
  const attempted: string[] = [];
  const result = await signInWithPasswordVariants({
    email: 'member@phantoms.test',
    password: raw,
    signIn: async ({ password }) => {
      attempted.push(password);
      return { data: null, error: invalidCredentials };
    },
  });
  assert.deepEqual(attempted, passwordVariants(raw));
  assert.equal(attempted.length, passwordVariants(raw).length);
  assert.ok(attempted.length > 1 && attempted.length <= MAX_PASSWORD_VARIANTS);
  assert.equal(result.attempts, attempted.length);
  assert.equal(result.normalized, false);
  assert.deepEqual(result.error, invalidCredentials);
});

test('passwordVariants: رموز الاتجاه المخفية والأرقام العربية بتتنضف في آخر محاولة', () => {
  const pasted = '\u200ESecretPassword\u0661\u0662\u0663\u200F';
  assert.equal(cleanCredentialText(pasted), 'SecretPassword123');
  const variants = passwordVariants(pasted);
  assert.equal(variants[0], pasted);
  assert.ok(variants.includes('SecretPassword123'));
  assert.ok(variants.length <= MAX_PASSWORD_VARIANTS);
});
test('signInWithPasswordVariants: كلمة مرور فيها علامة اتجاه مخفية بتدخل تلقائيًا', async () => {
  const result = await signInWithPasswordVariants({
    email: 'member@phantoms.test',
    password: 'SecretPassword123\u200F',
    signIn: async ({ password }) => (password === 'SecretPassword123'
      ? { data: { user: { id: 'user-1' } }, error: null }
      : { data: null, error: invalidCredentials }),
  });
  assert.ok(result.result);
  assert.equal(result.normalized, true);
});
