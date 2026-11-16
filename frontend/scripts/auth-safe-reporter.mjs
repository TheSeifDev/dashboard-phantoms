import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { sanitizeAuthEvidence, writeSanitizedAuthEvidence } from './auth-e2e-helpers.mjs';

function safeStatus(status) {
  return ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(status) ? status : 'interrupted';
}

function safeName(value) {
  const text = [...String(value ?? '')].filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('').slice(0, 200);
  return /https?:\/\/|[?#]|\b(?:token|password|secret|otp|code)\b/i.test(text) ? '[redacted]' : text;
}

function collectSteps(step, target) {
  const children = Array.isArray(step?.steps) ? step.steps : [];
  for (const child of children) collectSteps(child, target);
  target.push({ name: safeName(step?.title), status: step?.error ? 'failed' : 'passed' });
}

function readBooleanMetadata(test) {
  const allowed = new Set(['noVerifyBeforeCode', 'noEmailRedirectTo', 'memberLogoutScoped', 'nonmemberLogoutScoped']);
  const values = [];
  for (const annotation of test?.annotations ?? []) {
    if (annotation.type !== 'auth-safety') continue;
    try {
      const parsed = JSON.parse(annotation.description ?? '{}');
      for (const [name, passed] of Object.entries(parsed)) {
        if (allowed.has(name)) values.push({ name, passed: passed === true });
      }
    } catch {
      // Ignore malformed metadata without retaining any annotation content.
    }
  }
  return values;
}

export default class AuthSafeReporter {
  constructor(options = {}) {
    this.outputFile = path.resolve(options.outputFile ?? 'test-results/auth-evidence.json');
    this.tests = [];
    this.steps = [];
    this.metadata = [];
  }

  onTestEnd(test, result) {
    this.tests.push({ name: safeName(test.title), status: safeStatus(result.status) });
    for (const step of result.steps ?? []) collectSteps(step, this.steps);
    this.metadata.push(...readBooleanMetadata(test));
  }

  onEnd() {
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeSanitizedAuthEvidence(this.outputFile, {
      tests: this.tests,
      steps: this.steps,
      metadata: this.metadata,
    }, 'not-started');
  }
}

export { sanitizeAuthEvidence };
