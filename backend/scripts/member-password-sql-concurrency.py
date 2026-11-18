#!/usr/bin/env python3
"""SQL-only concurrency checks against the generated local Supabase PostgreSQL target."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import urllib.parse
import uuid

SERVICE = "SET LOCAL request.jwt.claims = '{\"role\":\"service_role\"}'; SET LOCAL ROLE service_role;"
TARGET = None
ENV = None


def fail(message):
    raise SystemExit(message)


def project_id(config):
    try:
        content = config.read_text(encoding='utf-8')
    except OSError:
        fail('Disposable Supabase config unavailable.')
    match = re.search(r'^project_id\s*=\s*"([^"]+)"\s*$', content, re.MULTILINE)
    value = match.group(1) if match else ''
    if not re.fullmatch(r'phantoms-disposable-\d+', value):
        fail('Refused: project is not an exact generated disposable namespace.')
    return value


def parse_env_output(raw):
    values = {}
    for line in raw.splitlines():
        match = re.match(r'^([A-Z0-9_]+)=(.*)$', line)
        if not match:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        values[match.group(1)] = value.replace('\\"', '"')
    return values


def local_status_target():
    backend = Path(__file__).resolve().parents[1]
    if (backend / 'supabase' / '.temp' / 'project-ref').exists():
        fail('Refused: linked Supabase projects are forbidden.')
    source_project = project_id(backend / 'supabase' / 'config.toml')
    native = os.environ.get('SUPABASE_EXPERIMENTAL_STACK') == '1'
    if native:
        runtime_value = os.environ.get('PHANTOMS_DISPOSABLE_RUNTIME_WORKDIR', '')
        runtime = Path(runtime_value) if runtime_value else None
        if not runtime or not runtime.is_absolute():
            fail('Refused: native runtime requires an explicit owned absolute workdir.')
        runtime = runtime.resolve()
        if (runtime / 'supabase' / '.temp' / 'project-ref').exists():
            fail('Refused: linked native runtime projects are forbidden.')
        if project_id(runtime / 'supabase' / 'config.toml') != source_project:
            fail('Refused: source and native runtime namespaces differ.')
        args = ['supabase', 'stack', 'status', '--experimental', '--workdir', str(runtime), '--env', '--output-format', 'text']
    else:
        args = ['supabase', 'status', '--workdir', str(backend), '-o', 'env']
    try:
        raw = subprocess.run(args, cwd=backend, text=True, capture_output=True, check=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        fail('Refused: could not read the exact local Supabase status.')
    values = parse_env_output(raw)
    api_url = values.get('API_URL') or values.get('SUPABASE_URL')
    db_url = values.get('DB_URL') or values.get('DATABASE_URL')
    if not api_url or not db_url:
        fail('Refused: local status omitted the API or database endpoint.')
    try:
        api = urllib.parse.urlparse(api_url)
        db = urllib.parse.urlparse(db_url)
        api_port = int(os.environ['PHANTOMS_LOCAL_API_PORT'])
        db_port = int(os.environ['PHANTOMS_LOCAL_DB_PORT'])
        parsed_db_port = db.port
    except (KeyError, TypeError, ValueError):
        fail('Refused: selected local API/database ports are invalid or missing.')
    if api.scheme != 'http' or api.hostname != '127.0.0.1' or api.port != api_port:
        fail('Refused: Supabase API is not the selected loopback endpoint.')
    if db.scheme not in ('postgres', 'postgresql') or db.hostname != '127.0.0.1' or parsed_db_port != db_port:
        fail('Refused: database is not the selected loopback endpoint.')
    if urllib.parse.unquote(db.username or '') != 'postgres' or db.path != '/postgres' or not db.password:
        fail('Refused: local PostgreSQL identity is not exact.')
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
    env.update({
        'PGPASSWORD': urllib.parse.unquote(db.password),
        'PGSSLMODE': 'disable',
        'PGCONNECT_TIMEOUT': '5',
    })
    target = ['psql', '-X', '-qAt', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
              '-p', str(db_port), '-U', 'postgres', '-d', 'postgres']
    return target, env


def sql(statement, allow_error=False):
    result = subprocess.run(TARGET + ['-c', statement], text=True, capture_output=True,
                            env=ENV, timeout=25)
    if result.returncode and not allow_error:
        raise RuntimeError('SQL operation failed; private database inspection required')
    return result


def concurrent_sql(statements):
    barrier = threading.Barrier(len(statements))

    def run(statement):
        barrier.wait(timeout=10)
        return sql(statement, allow_error=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(run, statements))


def run():
    global TARGET, ENV
    if sys.argv[1:] != ['--run-local-supabase']:
        fail('Use --run-local-supabase; arbitrary database targets are not accepted.')
    TARGET, ENV = local_status_target()
    try:
        database_user = sql("SELECT current_database() || '|' || current_user;").stdout.strip()
        if database_user != 'postgres|postgres':
            fail('Refused: local PostgreSQL database/user identity is not exact.')
        server_version_num = int(sql('SHOW server_version_num;').stdout.strip())
        if not 170000 <= server_version_num < 180000:
            fail('Refused: the local PostgreSQL server is not version 17.')
    except (RuntimeError, ValueError):
        fail('Refused: local PostgreSQL identity or version check failed.')

    actor, reset_user = str(uuid.uuid4()), str(uuid.uuid4())
    suffix = uuid.uuid4().hex
    emails = [f'concurrency-{suffix}-{kind}@phantoms-test.example' for kind in ('owner', 'new', 'reset')]
    invitation_hash = hashlib.sha256(('invitation-' + suffix).encode()).hexdigest()
    reset_hash = hashlib.sha256(('reset-' + suffix).encode()).hexdigest()
    limit_hash = hashlib.sha256(('limiter-' + suffix).encode()).hexdigest()
    registered = False
    evidence = {
        'schema': 'phantoms-local-pg17-sql-concurrency/v1',
        'mode': 'local-supabase-pg17-sql-only',
        'boundary': 'PostgreSQL only; fabricated Auth rows, not GoTrue',
        'pg17': True,
        'passed': False,
        'checks': [],
        'cleanupStatus': 'not-started',
    }
    try:
        registered = True
        sql(f"""BEGIN;
          INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          VALUES ('{actor}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{emails[0]}', 'synthetic-owner-hash', now(), '{{\"providers\":[\"email\"]}}', '{{}}', now(), now()),
                 ('{reset_user}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{emails[2]}', 'synthetic-reset-old-hash', now(), '{{\"providers\":[\"email\"]}}', '{{}}', now(), now());
          INSERT INTO public.admin_accounts(user_id, role, permissions) VALUES ('{actor}', 'owner', '{{\"dashboard\":true,\"members\":true,\"tasks\":true,\"ranking\":true,\"notes\":true,\"announcements\":true,\"whatsapp\":true,\"ai_assistant\":true}}');
          INSERT INTO public.members(email, full_name, completion_rank) VALUES ('{emails[1]}', 'Disposable concurrency new', 0), ('{emails[2]}', 'Disposable concurrency reset', 0);
          INSERT INTO public.member_auth_bindings(member_id, auth_user_id, normalized_email, password_ready)
          SELECT id, '{reset_user}', email, true FROM public.members WHERE email = '{emails[2]}';
          {SERVICE}
          SELECT public.member_password_issue_invitation('{invitation_hash}', (SELECT id FROM public.members WHERE email = '{emails[1]}'), '{emails[1]}', 'enroll', NULL, NULL, 24, 'synthetic concurrency', '{actor}');
          SELECT public.member_password_issue_invitation('{reset_hash}', (SELECT id FROM public.members WHERE email = '{emails[2]}'), '{emails[2]}', 'reset', '{reset_user}', NULL, 24, 'synthetic concurrency', '{actor}');
          COMMIT;""")
        reserve = f"BEGIN; {SERVICE} SELECT public.member_password_reserve('{invitation_hash}', '{emails[1]}'); SELECT pg_sleep(0.2); COMMIT;"
        outcomes = concurrent_sql([reserve] * 8)
        winners = sum(result.returncode == 0 for result in outcomes)
        rejected = sum(result.returncode != 0 and 'REVIEW_REQUIRED' in result.stderr for result in outcomes)
        durable = sql(f"SELECT count(*) FROM public.member_password_invitations WHERE token_hash = '{invitation_hash}' AND status = 'reserved' AND claim_id IS NOT NULL;").stdout.strip()
        assert (winners, rejected, durable) == (1, 7, '1')
        evidence['checks'].append({'name': 'eight simultaneous reserve transactions', 'connections': 8, 'successfulClaims': winners, 'reviewRejected': rejected, 'durableClaims': 1, 'passed': True})
        sql(f"BEGIN; {SERVICE} SELECT public.member_password_reserve('{reset_hash}', '{emails[2]}'); COMMIT;")
        writes = concurrent_sql([f"BEGIN; UPDATE auth.users SET encrypted_password = 'synthetic-reset-write-{i}' WHERE id = '{reset_user}'; SELECT pg_sleep(0.2); COMMIT;" for i in range(2)])
        allowed = sum(result.returncode == 0 for result in writes)
        blocked = sum(result.returncode != 0 and 'REVIEW_REQUIRED' in result.stderr for result in writes)
        assert (allowed, blocked) == (1, 1)
        marker = sql(f"SELECT count(*) FROM public.member_password_invitations WHERE token_hash = '{reset_hash}' AND auth_write_user_id = '{reset_user}' AND auth_write_completed_at IS NOT NULL;").stdout.strip()
        assert marker == '1'
        evidence['checks'].append({'name': 'two simultaneous reset password writes', 'connections': 2, 'allowedWrites': allowed, 'blockedWrites': blocked, 'exactUuidMarkers': 1, 'passed': True})
        limits = concurrent_sql([f"BEGIN; {SERVICE} SELECT public.member_password_check_rate_limit('{limit_hash}', 100, 900, 900); COMMIT;" for _ in range(12)])
        assert all(result.returncode == 0 for result in limits)
        attempts = int(sql(f"SELECT attempts FROM public.member_password_rate_limits WHERE key_hash = '{limit_hash}';").stdout.strip())
        assert attempts == 12
        evidence['checks'].append({'name': 'twelve simultaneous limiter increments', 'connections': 12, 'durableAttempts': attempts, 'passed': True})
        evidence['passed'] = True
    finally:
        if registered:
            # Exact UUIDs/emails/hashes registered by THIS invocation, never pattern cleanup.
            sql(f"""BEGIN;
              DELETE FROM public.member_password_audit WHERE invitation_id IN (SELECT id FROM public.member_password_invitations WHERE token_hash IN ('{invitation_hash}', '{reset_hash}'));
              DELETE FROM public.member_password_invitations WHERE token_hash IN ('{invitation_hash}', '{reset_hash}');
              DELETE FROM public.member_auth_bindings WHERE auth_user_id = '{reset_user}';
              DELETE FROM public.members WHERE email IN ('{emails[1]}', '{emails[2]}');
              DELETE FROM public.admin_accounts WHERE user_id = '{actor}';
              DELETE FROM auth.users WHERE id IN ('{actor}', '{reset_user}');
              DELETE FROM public.member_password_rate_limits WHERE key_hash = '{limit_hash}';
              COMMIT;""")
            remaining = sql(f"SELECT (SELECT count(*) FROM auth.users WHERE id IN ('{actor}', '{reset_user}')) + (SELECT count(*) FROM public.members WHERE email IN ('{emails[1]}', '{emails[2]}')) + (SELECT count(*) FROM public.member_password_invitations WHERE token_hash IN ('{invitation_hash}', '{reset_hash}')) + (SELECT count(*) FROM public.member_password_rate_limits WHERE key_hash = '{limit_hash}');").stdout.strip()
            assert remaining == '0'
            evidence['cleanupStatus'] = 'completed-exact-fixtures'
        print(json.dumps(evidence, indent=2))
    return 0 if evidence['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(run())
