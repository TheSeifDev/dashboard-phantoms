#!/usr/bin/env bash
# Local-only, fresh Supabase PG17 + full pgTAP validation.
# Never add --remote here. Execution requires an explicit readiness acknowledgement.
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
EXPECTED_NODE='v22.23.4'
EXPECTED_SUPABASE='3.1.0'
EXPECTED_PG_IMAGE='public.ecr.aws/supabase/postgres:17.11.0.018'
EXCLUDED_SERVICES='studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,storage-api'
RUN_ROOT=''
WORKDIR=''
PROJECT_ID=''
RUN_ID=''
NETWORK_NAME=''
NETWORK_ID=''
STACK_ATTEMPTED=0
NETWORK_CREATED=0
CLEANUP_FAILED=0

usage() {
  cat <<'EOF'
Usage:
  backend/scripts/validate-web-projects-local.sh --preflight
  PHANTOMS_WEB_PROJECTS_LOCAL_READY=1 backend/scripts/validate-web-projects-local.sh --run

--preflight checks local dependencies, manifests, test rollback boundaries, and
safety preconditions. It does not create a container/network or execute SQL.
--run creates a fresh uniquely named local stack, resets it from every migration
file represented by the manifests, runs every *.test.sql pgTAP suite, and tears
only that run's resources down. It requires the readiness variable above.
EOF
}

refuse() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }

require_clean_local_environment() {
  local name
  for name in \
    SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD DATABASE_URL SUPABASE_DB_URL \
    SUPABASE_SERVICE_ROLE_KEY SUPABASE_SERVICE_KEY SUPABASE_SECRET_KEY \
    SERVICE_ROLE_KEY JWT_SECRET SUPABASE_JWT_SECRET ANON_KEY POSTGRES_URL \
    DIRECT_URL SB_SECRET_KEY SB_ACCESS_TOKEN PGHOST PGPORT PGUSER PGPASSWORD \
    PGDATABASE PGURI; do
    if [[ -n "${!name:-}" ]]; then
      refuse "environment variable $name is set; unset database/hosted credentials before local validation"
    fi
  done
  [[ -z "${DOCKER_HOST:-}" ]] || refuse 'DOCKER_HOST is set; use the default local Docker context only'
  [[ "$(docker context show)" == 'default' ]] || refuse 'Docker context must be default'
  [[ ! -e "$ROOT/backend/supabase/.temp/project-ref" ]] || refuse 'repository Supabase workdir is linked to a hosted project'
  [[ ! -e "$ROOT/frontend/.env.local" ]] || refuse 'frontend/.env.local exists; remove/secure it before local validation'
}

validate_test_files() {
  python3 - "$ROOT/backend/supabase/tests/database" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
files = sorted(root.glob('*.test.sql'))
if not files:
    raise SystemExit('No *.test.sql pgTAP suites found.')
missing = []
for path in files:
    text = path.read_text(encoding='utf-8')
    begins = len(re.findall(r'(?im)^\s*(?:BEGIN|START\s+TRANSACTION)\s*;', text))
    rollbacks = len(re.findall(r'(?im)^\s*ROLLBACK(?:\s+AND\s+CHAIN)?\s*;', text))
    if begins == 0 or begins != rollbacks:
        missing.append(f'{path.name}: transaction begins={begins}, rollbacks={rollbacks}')
if missing:
    raise SystemExit('Every pgTAP suite must preserve balanced transaction/rollback cleanup:\n  ' + '\n  '.join(missing))
print(f'pgTAP suites: {len(files)}; every suite has balanced BEGIN/ROLLBACK boundaries.')
PY
}

preflight() {
  local tool node_version cli_version
  for tool in docker node python3 psql supabase; do
    command -v "$tool" >/dev/null 2>&1 || refuse "required local tool is unavailable: $tool"
  done
  node_version="$(node --version)"
  [[ "$node_version" == "$EXPECTED_NODE" ]] || refuse "Node.js $EXPECTED_NODE required by repo CI, found $node_version"
  cli_version="$(supabase --version 2>/dev/null | head -n 1)"
  [[ "$cli_version" == "$EXPECTED_SUPABASE" ]] || refuse "Supabase CLI $EXPECTED_SUPABASE required by repo CI, found $cli_version"
  docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || refuse 'local Docker daemon is unavailable'
  require_clean_local_environment
  docker image inspect "$EXPECTED_PG_IMAGE" >/dev/null 2>&1 || refuse "expected PG17 image is not cached locally: $EXPECTED_PG_IMAGE"
  [[ "$(python3 - "$ROOT/backend/supabase/config.toml" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f:
    print(tomllib.load(f)['db']['major_version'])
PY
)" == '17' ]] \
    || refuse 'backend/supabase/config.toml must specify major_version = 17'
  [[ -f "$ROOT/backend/supabase/tests/database/_helpers.psql" ]] || refuse 'shared pgTAP helper is missing'
  validate_test_files
  printf '%s\n' 'Validating initialization/forward manifests and immutable SQL checksums (filesystem-only)...'
  node "$ROOT/backend/scripts/migration-manifest.mjs"
  printf '%s\n' 'Preflight passed. No Docker resource was created and no SQL was executed.'
}

choose_loopback_ports() {
  python3 - <<'PY'
import socket
for base in range(24000, 60000, 4):
    sockets = []
    try:
        for port in range(base, base + 4):
            sock = socket.socket()
            sock.bind(('127.0.0.1', port))
            sockets.append(sock)
        print(base)
        break
    except OSError:
        pass
    finally:
        for sock in sockets:
            sock.close()
else:
    raise SystemExit('No available loopback port quartet in 24000-59999.')
PY
}

configure_temp_workdir() {
  local base="$1" api_port db_port shadow_port preview_port config_source
  api_port="$base"
  db_port="$((base + 1))"
  shadow_port="$((base + 2))"
  preview_port="$((base + 3))"
  config_source="$ROOT/backend/supabase/config.toml"

  mkdir -p "$WORKDIR/supabase"
  cp -- "$config_source" "$WORKDIR/supabase/config.toml"
  cp -a -- "$ROOT/backend/supabase/migrations" "$WORKDIR/supabase/"
  cp -a -- "$ROOT/backend/supabase/tests" "$WORKDIR/supabase/"
  if [[ -d "$ROOT/backend/supabase/templates" ]]; then
    cp -a -- "$ROOT/backend/supabase/templates" "$WORKDIR/supabase/"
  fi

  node --input-type=module - "$ROOT" "$WORKDIR/supabase/config.toml" "$PROJECT_ID" "$api_port" "$db_port" "$shadow_port" "$preview_port" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [root, configPath, projectId, api, db, shadow, preview] = process.argv.slice(2);
const { rewriteDisposableConfig } = await import(`file://${resolve(root, 'backend/scripts/configure-disposable-stack.mjs')}`);
const source = readFileSync(configPath, 'utf8');
const rewritten = rewriteDisposableConfig(source, {
  projectId,
  apiPort: Number(api),
  dbPort: Number(db),
  shadowPort: Number(shadow),
  previewOrigin: `http://127.0.0.1:${preview}`,
});
writeFileSync(configPath, rewritten);
NODE

  python3 - "$WORKDIR/supabase/config.toml" "$PROJECT_ID" "$api_port" "$db_port" <<'PY'
import sys, tomllib
path, project, api, db = sys.argv[1:]
with open(path, 'rb') as f:
    config = tomllib.load(f)
assert config['project_id'] == project
assert config['db']['major_version'] == 17
assert config['api']['port'] == int(api) and config['db']['port'] == int(db)
assert config['auth']['enable_signup'] is False
assert config['auth']['email']['enable_confirmations'] is True
for line in open(path, encoding='utf-8'):
    active = line.split('#', 1)[0]
    if 'supabase.co' in active.lower() or 'vercel.app' in active.lower():
        raise SystemExit('Generated local config contains an active hosted-service reference.')
PY
  [[ ! -e "$WORKDIR/supabase/.temp/project-ref" ]] || refuse 'temporary workdir unexpectedly contains a hosted project link'
}

create_loopback_network() {
  NETWORK_ID="$(docker network create \
    --driver bridge \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
    --label "manus.phantoms.web-projects-local=$RUN_ID" \
    "$NETWORK_NAME")"
  NETWORK_CREATED=1
  local facts
  facts="$(docker network inspect --format '{{.Name}}|{{.Id}}|{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}|{{index .Labels "manus.phantoms.web-projects-local"}}' "$NETWORK_ID")"
  [[ "$facts" == "$NETWORK_NAME|$NETWORK_ID|127.0.0.1|$RUN_ID" ]] || refuse 'created Docker bridge did not retain the exact loopback-only option and ownership label'
}

owned_container_ids() {
  local ids
  ids="$(docker ps -aq --filter "label=com.supabase.cli.project=$PROJECT_ID" 2>/dev/null || true)"
  if [[ -z "$ids" ]]; then
    ids="$(docker ps -aq --format '{{.ID}}\t{{.Names}}' 2>/dev/null | awk -F '\t' -v suffix="_$PROJECT_ID" 'length($2) >= length(suffix) && substr($2, length($2)-length(suffix)+1) == suffix { print $1 }' || true)"
  fi
  printf '%s\n' "$ids" | awk 'NF && !seen[$0]++'
}

assert_owned_containers_and_loopback() {
  local ids
  ids="$(owned_container_ids)"
  [[ -n "$ids" ]] || refuse "no running containers found for the generated local project $PROJECT_ID"
  mapfile -t id_array <<< "$ids"
  docker inspect "${id_array[@]}" | python3 -c '
import json,sys
items=json.load(sys.stdin)
if not items: raise SystemExit("owned container inspection is empty")
pg=[]; unsafe=[]
for c in items:
    name=c.get("Name", "").lstrip("/")
    image=c.get("Config",{}).get("Image","")
    if "_db_" in name or name.startswith("supabase_db_"):
        pg.append((name,image))
    for port, binds in (c.get("NetworkSettings",{}).get("Ports") or {}).items():
        for bind in binds or []:
            host=bind.get("HostIp","")
            if host not in ("127.0.0.1", "::1"):
                unsafe.append({"name":name,"containerPort":port,"hostIp":host})
if unsafe:
    print(json.dumps({"nonLoopbackBindings":unsafe},sort_keys=True),file=sys.stderr)
    raise SystemExit("local stack published a non-loopback binding")
if not pg or any(image != "public.ecr.aws/supabase/postgres:17.11.0.018" for _,image in pg):
    raise SystemExit("local database container did not use the expected PG17 image: " + repr(pg))
print("Owned containers: %d; PG17 image: %s; all published ports are loopback-only." % (len(items), pg[0][1]))
'
}

get_local_urls() {
  local status_env
  status_env="$(supabase status --workdir "$WORKDIR" --network-id "$NETWORK_ID" -o env 2>/dev/null)" \
    || refuse 'Supabase local status failed'
  local extracted
  extracted="$(LOCAL_STATUS="$status_env" EXPECTED_API_PORT="$API_PORT" EXPECTED_DB_PORT="$DB_PORT" python3 - <<'PY'
import os, sys
from urllib.parse import urlparse
values={}
for line in os.environ['LOCAL_STATUS'].splitlines():
    if '=' in line:
        key, value=line.split('=',1)
        values[key]=value.strip().strip('"').strip("'")
api=values.get('API_URL') or values.get('SUPABASE_URL')
db=values.get('DB_URL') or values.get('DATABASE_URL')
if not api or not db: raise SystemExit('local status omitted API_URL or DB_URL')
a=urlparse(api); d=urlparse(db)
if a.scheme != 'http' or a.hostname != '127.0.0.1' or a.port != int(os.environ['EXPECTED_API_PORT']):
    raise SystemExit('local API URL is not the exact selected loopback endpoint')
if d.scheme not in ('postgres','postgresql') or d.hostname != '127.0.0.1' or d.port != int(os.environ['EXPECTED_DB_PORT']):
    raise SystemExit('local database URL is not the exact selected loopback endpoint')
print(api)
print(db)
print(values.get('ANON_KEY') or values.get('SUPABASE_ANON_KEY') or '')
PY
)" || refuse 'local stack URLs did not validate as loopback-only'
  API_URL="$(printf '%s\n' "$extracted" | sed -n '1p')"
  DB_URL="$(printf '%s\n' "$extracted" | sed -n '2p')"
  ANON_KEY="$(printf '%s\n' "$extracted" | sed -n '3p')"
  [[ -n "$ANON_KEY" ]] || refuse 'local status omitted its generated local anon key'
}

verify_auth_local_policy() {
  API_URL="$API_URL" ANON_KEY="$ANON_KEY" python3 - <<'PY'
import json, os, urllib.request
request=urllib.request.Request(
    os.environ['API_URL'] + '/auth/v1/settings',
    headers={'apikey':os.environ['ANON_KEY'], 'Authorization':'Bearer '+os.environ['ANON_KEY']})
with urllib.request.urlopen(request, timeout=15) as response:
    settings=json.load(response)
if settings.get('disable_signup') is not True or settings.get('mailer_autoconfirm') is not False:
    raise SystemExit('local Auth signup/confirmation settings are not safely disabled/confirmed')
print('Local Auth endpoint reports signup disabled and email confirmation required.')
PY
}

verify_migration_history() {
  local actual expected major
  supabase migration list --local --workdir "$WORKDIR" --network-id "$NETWORK_ID" >/dev/null
  major="$(psql "$DB_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT current_setting('server_version_num')::int / 10000")"
  [[ "$major" == '17' ]] || refuse "database server is not PostgreSQL 17 (major=$major)"
  expected="$(find "$WORKDIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sed -E 's/^([0-9]{14})_.*/\1/' | sort)"
  actual="$(psql "$DB_URL" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')"
  [[ -n "$expected" ]] || refuse 'no local migrations copied into isolated workdir'
  if [[ "$actual" != "$expected" ]]; then
    printf '%s\n' 'Expected local migration versions:' "$expected" 'Actual applied local migration versions:' "$actual" >&2
    refuse 'fresh local database history does not exactly match every SQL migration file'
  fi
  printf 'Applied all %s manifest-validated migration files; PostgreSQL major version %s.\n' "$(printf '%s\n' "$expected" | wc -l | tr -d ' ')" "$major"
}

find_project_volumes() {
  local ids
  ids="$(docker volume ls -q --filter "label=com.supabase.cli.project=$PROJECT_ID" 2>/dev/null || true)"
  if [[ -z "$ids" ]]; then
    ids="$(docker volume ls --format '{{.Name}}' 2>/dev/null | awk -v suffix="_$PROJECT_ID" 'length($0) >= length(suffix) && substr($0, length($0)-length(suffix)+1) == suffix { print $0 }' || true)"
  fi
  printf '%s\n' "$ids" | awk 'NF && !seen[$0]++'
}

cleanup() {
  local original_status=$? ids volumes networks id details network_ids
  trap - EXIT INT TERM
  set +e
  if [[ "$STACK_ATTEMPTED" == 1 ]]; then
    if ! supabase stop --workdir "$WORKDIR" --no-backup --network-id "$NETWORK_ID" >/dev/null 2>&1; then
      printf '%s\n' 'Cleanup warning: supabase stop returned non-zero; checking exact project-owned resources.' >&2
      CLEANUP_FAILED=1
    fi
  fi

  ids="$(owned_container_ids)"
  if [[ -n "$ids" ]]; then
    # Fail closed unless every remaining container is positively tied to this unique project.
    mapfile -t ids_array <<< "$ids"
    if docker inspect "${ids_array[@]}" | python3 -c 'import json,sys
project=sys.argv[1]
try: items=json.load(sys.stdin)
except Exception: raise SystemExit(1)
for c in items:
    labels=(c.get("Config") or {}).get("Labels") or {}
    name=(c.get("Name") or "").lstrip("/")
    if labels.get("com.supabase.cli.project") != project and not name.endswith("_"+project):
        raise SystemExit(1)' "$PROJECT_ID"; then
      docker rm --force "${ids_array[@]}" >/dev/null 2>&1 || CLEANUP_FAILED=1
    else
      printf 'Cleanup refused to remove a container not positively owned by project %s.\n' "$PROJECT_ID" >&2
      CLEANUP_FAILED=1
    fi
  fi

  volumes="$(find_project_volumes)"
  if [[ -n "$volumes" ]]; then
    while IFS= read -r volume; do
      [[ -n "$volume" ]] || continue
      details="$(docker volume inspect --format '{{.Name}}|{{index .Labels "com.supabase.cli.project"}}' "$volume" 2>/dev/null)"
      if [[ "$details" == "$volume|$PROJECT_ID" || "$volume" == *"_$PROJECT_ID" ]]; then
        docker volume rm "$volume" >/dev/null 2>&1 || CLEANUP_FAILED=1
      else
        printf 'Cleanup refused to remove an unverified volume: %s\n' "$volume" >&2
        CLEANUP_FAILED=1
      fi
    done <<< "$volumes"
  fi

  network_ids=''
  if [[ "$NETWORK_CREATED" == 1 && -n "$NETWORK_ID" ]]; then
    if docker network inspect "$NETWORK_ID" >/dev/null 2>&1; then
      details="$(docker network inspect --format '{{.Name}}|{{.Id}}|{{index .Labels "manus.phantoms.web-projects-local"}}' "$NETWORK_ID" 2>/dev/null)"
      if [[ "$details" == "$NETWORK_NAME|$NETWORK_ID|$RUN_ID" ]]; then
        network_ids="$NETWORK_ID"
      else
        printf 'Cleanup refused to remove an unverified bridge network: %s\n' "$NETWORK_ID" >&2
        CLEANUP_FAILED=1
      fi
    else
      NETWORK_CREATED=0
    fi
  fi
  # Remove any additional Supabase-generated network only when its exact project label matches.
  local labeled_networks named_networks candidate
  labeled_networks="$(docker network ls -q --filter "label=com.supabase.cli.project=$PROJECT_ID" 2>/dev/null || true)"
  named_networks="$(docker network ls --format '{{.ID}}\t{{.Name}}' 2>/dev/null | awk -F '\t' -v expected="supabase_network_$PROJECT_ID" '$2 == expected { print $1 }' || true)"
  for candidate in $labeled_networks $named_networks; do
    [[ -n "$candidate" ]] || continue
    [[ " $network_ids " == *" $candidate "* ]] && continue
    details="$(docker network inspect --format '{{.Name}}|{{index .Labels "com.supabase.cli.project"}}' "$candidate" 2>/dev/null)"
    if [[ "$details" == "supabase_network_$PROJECT_ID|$PROJECT_ID" ]]; then
      network_ids+=" $candidate"
    else
      printf 'Cleanup refused to remove an unverified Supabase network: %s (%s)\n' "$candidate" "$details" >&2
      CLEANUP_FAILED=1
    fi
  done
  for id in $network_ids; do
    local attached
    attached="$(docker network inspect --format '{{len .Containers}}' "$id" 2>/dev/null)"
    if [[ "$attached" == 0 ]]; then
      docker network rm "$id" >/dev/null 2>&1 || CLEANUP_FAILED=1
    else
      printf 'Owned network %s still has attached containers; leaving it intact for diagnosis.\n' "$id" >&2
      CLEANUP_FAILED=1
    fi
  done

  if [[ -n "$RUN_ROOT" && "$RUN_ROOT" == /tmp/phantoms-web-projects-local.* && -d "$RUN_ROOT" ]]; then
    rm -rf -- "$RUN_ROOT" || CLEANUP_FAILED=1
  fi
  if [[ "$CLEANUP_FAILED" == 0 ]]; then
    printf '%s\n' 'Exact local Supabase containers/volumes and the owned loopback bridge were removed.'
  else
    printf '%s\n' 'ERROR: owned-resource cleanup was not fully verified.' >&2
    original_status=1
  fi
  if [[ "$original_status" == 0 && "$CLEANUP_FAILED" != 0 ]]; then original_status=1; fi
  exit "$original_status"
}

case "${1:-}" in
  --preflight)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    preflight
    ;;
  --run)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    [[ "${PHANTOMS_WEB_PROJECTS_LOCAL_READY:-}" == 1 ]] || refuse 'wait for explicit parent readiness; set PHANTOMS_WEB_PROJECTS_LOCAL_READY=1 only after approval'
    preflight
    RUN_ID="$(date -u +%Y%m%d%H%M%S)$$"
    PROJECT_ID="phantoms-disposable-$RUN_ID"
    NETWORK_NAME="phantoms-web-projects-local-$RUN_ID"
    RUN_ROOT="$(mktemp -d /tmp/phantoms-web-projects-local.XXXXXX)"
    WORKDIR="$RUN_ROOT/runtime"
    trap cleanup EXIT INT TERM
    API_PORT_BASE="$(choose_loopback_ports)"
    API_PORT="$API_PORT_BASE"
    DB_PORT="$((API_PORT_BASE + 1))"
    configure_temp_workdir "$API_PORT_BASE"
    create_loopback_network
    printf 'Starting isolated local-only PG17 stack %s (API port %s, DB port %s).\n' "$PROJECT_ID" "$API_PORT" "$DB_PORT"
    STACK_ATTEMPTED=1
    supabase start --workdir "$WORKDIR" --network-id "$NETWORK_ID" -x "$EXCLUDED_SERVICES"
    assert_owned_containers_and_loopback
    get_local_urls
    verify_auth_local_policy
    printf '%s\n' 'Resetting the fresh, isolated database from the complete local migration directory (no seed).'
    supabase db reset --workdir "$WORKDIR" --network-id "$NETWORK_ID" --no-seed
    verify_migration_history
    printf '%s\n' 'Running every pgTAP suite discovered under supabase/tests/database; each source suite must retain rollback cleanup.'
    supabase test db --workdir "$WORKDIR" --network-id "$NETWORK_ID"
    printf '%s\n' 'PASS: local PG17 migration history and all pgTAP suites completed.'
    if [[ "${PHANTOMS_WEB_PROJECTS_LIVE:-}" == 1 ]]; then
      printf '%s\n' 'Running actual local Web Projects API/Auth/Browser workflows before owned-stack teardown.'
      PHANTOMS_DISPOSABLE_E2E=1 PHANTOMS_LOCAL_WORKDIR="$WORKDIR" \
        PHANTOMS_LOCAL_PROJECT_ID="$PROJECT_ID" PHANTOMS_LOCAL_NETWORK_ID="$NETWORK_ID" \
        PHANTOMS_LOCAL_API_PORT="$API_PORT" PHANTOMS_LOCAL_DB_PORT="$DB_PORT" \
        PHANTOMS_LOCAL_PREVIEW_PORT="$((API_PORT_BASE + 3))" \
        node "$ROOT/frontend/scripts/web-projects-live.test.mjs"
    fi
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
