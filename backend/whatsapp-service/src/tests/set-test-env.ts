// Preload for integration tests: must run BEFORE the app module loads so that
// config picks up test mode (explicit dev-bypass allowed, production stays closed).
process.env.NODE_ENV = 'test';

// Ephemeral VAPID keys so the push route reaches payload validation
// (never written to disk, test process only).
const { default: webpush } = await import('web-push');
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
