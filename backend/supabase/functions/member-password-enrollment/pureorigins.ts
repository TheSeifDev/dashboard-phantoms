export const PRODUCTION_ORIGIN = 'https://dashboard-phantoms.vercel.app';

const LOOPBACK_HOST = '127.0.0.1';
const MIN_NON_PRIVILEGED_PORT = 1024;
const MAX_PORT = 65535;

export type OriginConfigurationInput = {
  allowedOrigins?: string | null;
  appUrl?: string | null;
  disposableAuth?: string | null;
};

export type OriginConfiguration = {
  valid: boolean;
  disposable: boolean;
  origins: readonly string[];
};

function configuredValues(value: string | null | undefined): { present: boolean; values: string[] } {
  if (value === undefined || value === null) return { present: false, values: [] };
  if (value.trim() === '') return { present: true, values: [] };
  const values = value.split(',').map((item) => item.trim());
  return { present: true, values };
}

function isExactOrigin(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.origin === value;
  } catch {
    return false;
  }
}

export function isExactProductionOrigin(value: string): boolean {
  return value === PRODUCTION_ORIGIN && isExactOrigin(value);
}

export function isExactLoopbackHttpOrigin(value: string): boolean {
  if (!isExactOrigin(value)) return false;
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    return parsed.protocol === 'http:'
      && parsed.hostname === LOOPBACK_HOST
      && parsed.port !== ''
      && Number.isInteger(port)
      && port >= MIN_NON_PRIVILEGED_PORT
      && port <= MAX_PORT;
  } catch {
    return false;
  }
}

export function validateOriginConfiguration(input: OriginConfigurationInput = {}): OriginConfiguration {
  const disposable = input.disposableAuth === '1';
  const flagIsValid = input.disposableAuth === undefined
    || input.disposableAuth === null
    || input.disposableAuth === '1'
    || input.disposableAuth === '0';
  const configured = configuredValues(input.allowedOrigins);
  const app = input.appUrl === undefined || input.appUrl === null ? null : input.appUrl.trim();
  const appWasProvided = input.appUrl !== undefined && input.appUrl !== null;
  const values = [...configured.values];
  if (appWasProvided) values.push(app ?? '');

  // A local/disposable function must state its public browser origin explicitly;
  // it may never inherit the hosted dashboard or accept a preview/other host.
  if (disposable) {
    const valid = flagIsValid
      && values.length > 0
      && values.every((origin) => isExactLoopbackHttpOrigin(origin));
    return { valid, disposable: true, origins: valid ? [...new Set(values)] : [] };
  }

  // Production is intentionally a code/config invariant. Environment values
  // can repeat the one approved origin, but cannot expand the allowlist.
  const valid = flagIsValid
    && values.every((origin) => isExactProductionOrigin(origin));
  return {
    valid,
    disposable: false,
    origins: valid ? [PRODUCTION_ORIGIN] : [],
  };
}
