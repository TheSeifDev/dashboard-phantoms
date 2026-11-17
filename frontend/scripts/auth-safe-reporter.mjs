import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  AUTH_ALLOWED_LABELS,
  AUTH_REQUIRED_METADATA,
  AUTH_STAGE_TITLES,
  AUTH_TEST_TITLE,
  sanitizeAuthEvidence,
  sanitizeAuthLabel,
  writeSanitizedAuthEvidence,
} from './auth-e2e-helpers.mjs';

function safeStatus(status) {
  return ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(status) ? status : 'interrupted';
}

function readBooleanMetadata(test) {
  const allowed = new Set(AUTH_REQUIRED_METADATA);
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
    this.tests.push({ name: sanitizeAuthLabel(test?.title), status: safeStatus(result?.status) });
    for (const step of Array.isArray(result?.steps) ? result.steps : []) {
      if (step?.category !== 'test.step') continue;
      this.steps.push({ name: sanitizeAuthLabel(step?.title), status: step?.error ? 'failed' : 'passed' });
    }
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

export {
  AUTH_ALLOWED_LABELS,
  AUTH_REQUIRED_METADATA,
  AUTH_STAGE_TITLES,
  AUTH_TEST_TITLE,
  sanitizeAuthEvidence,
  sanitizeAuthLabel,
};
