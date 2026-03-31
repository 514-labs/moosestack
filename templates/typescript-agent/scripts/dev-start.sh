#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_APP_DIR="${ROOT_DIR}/packages/web-app"
SERVICE_DIR="${ROOT_DIR}/packages/moosestack-service"
WEB_ENV_EXAMPLE="${WEB_APP_DIR}/.env.example"
WEB_ENV_LOCAL="${WEB_APP_DIR}/.env.local"
SERVICE_ENV_EXAMPLE="${SERVICE_DIR}/.env.example"
SERVICE_ENV_LOCAL="${SERVICE_DIR}/.env.local"

PREPARE_ONLY=false
MOOSE_TIMEOUT_SECONDS="${MOOSE_TIMEOUT_SECONDS:-180}"
WEB_TIMEOUT_SECONDS="${WEB_TIMEOUT_SECONDS:-120}"
WEB_APP_URL="${WEB_APP_URL:-http://localhost:3000}"
CONTAINER_CLI=""
MOOSE_PID=""
WEB_PID=""

log() {
  printf '[dev-start] %s\n' "$*"
}

fail() {
  printf '[dev-start] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-start.sh [--prepare-only]

  --prepare-only   Create local env files from .env.example and exit.
  -h, --help       Show this help text.

The full startup flow:
1. Creates packages/*/.env.local files if they are missing
2. Verifies Docker or Finch is available
3. Starts the Moose service
4. Waits for Moose /ready and the MCP /tools endpoint
5. Starts the web app
6. Waits for /api/chat/status
EOF
}

cleanup() {
  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi

  if [[ -n "${MOOSE_PID}" ]] && kill -0 "${MOOSE_PID}" 2>/dev/null; then
    kill "${MOOSE_PID}" 2>/dev/null || true
  fi

  if [[ -n "${WEB_PID}" ]]; then
    wait "${WEB_PID}" 2>/dev/null || true
  fi

  if [[ -n "${MOOSE_PID}" ]]; then
    wait "${MOOSE_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prepare-only)
      PREPARE_ONLY=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

generate_auth_secret() {
  node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
}

generate_local_jwt_keypair() {
  node -e 'const { generateKeyPairSync } = require("node:crypto"); const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }); console.log(JSON.stringify({ privateKey: privateKey.replace(/\n/g, "\\n"), publicKey: publicKey.replace(/\n/g, "\\n") }));'
}

derive_public_key_from_private() {
  local private_key="$1"

  node -e 'const { createPrivateKey, createPublicKey } = require("node:crypto"); const privateKey = process.argv[1].replace(/\\n/g, "\n"); const publicKey = createPublicKey(createPrivateKey(privateKey)).export({ type: "spki", format: "pem" }); process.stdout.write(publicKey.trimEnd());' -- "${private_key}"
}

copy_if_missing() {
  local source_path="$1"
  local target_path="$2"

  if [[ -f "${target_path}" ]]; then
    log "Using existing ${target_path#"${ROOT_DIR}/"}"
    return
  fi

  cp "${source_path}" "${target_path}"
  log "Created ${target_path#"${ROOT_DIR}/"} from ${source_path#"${ROOT_DIR}/"}"
}

set_env_value() {
  local file_path="$1"
  local variable_name="$2"
  local variable_value="$3"
  local temp_file
  temp_file="$(mktemp)"

  awk -v name="${variable_name}" -v value="${variable_value}" '
    BEGIN { updated = 0 }
    index($0, name "=") == 1 {
      print name "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print name "=" value
      }
    }
  ' "${file_path}" > "${temp_file}"

  mv "${temp_file}" "${file_path}"
}

seed_web_auth_secret() {
  if ! grep -q '^AUTH_SECRET=replace-me-with-a-random-secret$' "${WEB_ENV_LOCAL}"; then
    return
  fi

  local secret
  secret="$(generate_auth_secret)"
  set_env_value "${WEB_ENV_LOCAL}" "AUTH_SECRET" "${secret}"
  log "Generated AUTH_SECRET in packages/web-app/.env.local"
}

seed_local_jwt_keys() {
  local existing_private_key=""
  local existing_public_key=""
  local derived_public_key=""

  existing_private_key="$(read_env_value "${WEB_ENV_LOCAL}" "LOCAL_DEV_JWT_PRIVATE_KEY" || true)"
  existing_public_key="$(read_env_value "${SERVICE_ENV_LOCAL}" "MOOSE_JWT__SECRET" || true)"

  if [[ -z "${existing_private_key}" && -z "${existing_public_key}" ]]; then
    local keypair_json
    keypair_json="$(generate_local_jwt_keypair)"
    local private_key
    local public_key
    private_key="$(node -e 'const keypair = JSON.parse(process.argv[1]); process.stdout.write(keypair.privateKey);' "${keypair_json}")"
    public_key="$(node -e 'const keypair = JSON.parse(process.argv[1]); process.stdout.write(keypair.publicKey);' "${keypair_json}")"

    set_env_value "${WEB_ENV_LOCAL}" "LOCAL_DEV_JWT_PRIVATE_KEY" "\"${private_key}\""
    set_env_value "${SERVICE_ENV_LOCAL}" "MOOSE_JWT__SECRET" "\"${public_key}\""
    log "Generated a local RSA keypair for tenant JWTs"
    return
  fi

  if [[ -n "${existing_private_key}" && -n "${existing_public_key}" ]]; then
    derived_public_key="$(derive_public_key_from_private "${existing_private_key}")"
    if [[ "${derived_public_key}" != "${existing_public_key}" ]]; then
      fail "Detected mismatched local JWT keypair. LOCAL_DEV_JWT_PRIVATE_KEY in packages/web-app/.env.local does not match MOOSE_JWT__SECRET in packages/moosestack-service/.env.local. Remove both values and rerun pnpm env:prepare"
    fi
  fi
}

ensure_env_files() {
  copy_if_missing "${SERVICE_ENV_EXAMPLE}" "${SERVICE_ENV_LOCAL}"
  copy_if_missing "${WEB_ENV_EXAMPLE}" "${WEB_ENV_LOCAL}"
  seed_web_auth_secret
  seed_local_jwt_keys
}

read_env_value() {
  local file_path="$1"
  local variable_name="$2"

  if [[ ! -f "${file_path}" ]]; then
    return 1
  fi

  local value
  value="$(
    awk -v name="${variable_name}" '
      BEGIN {
        prefix = name "="
        capture = 0
        current = ""
        value = ""
        found = 0
      }
      capture == 1 {
        current = current ORS $0
        if ($0 ~ /"$/) {
          value = current
          found = 1
          capture = 0
        }
        next
      }
      index($0, prefix) == 1 {
        current = substr($0, length(prefix) + 1)
        if (current ~ /^"/ && current !~ /"$/) {
          capture = 1
          next
        }
        value = current
        found = 1
      }
      END {
        if (capture == 1) {
          value = current
          found = 1
        }
        if (found) {
          print value
        }
      }
    ' "${file_path}"
  )"

  if [[ -z "${value}" ]]; then
    return 1
  fi

  value="${value%$'\r'}"
  if [[ "${value}" == '"'*'"' ]]; then
    value="${value#\"}"
    value="${value%\"}"
  fi

  printf '%s\n' "${value}"
}

resolve_web_env_value() {
  local variable_name="$1"
  local default_value="$2"
  local value=""

  if [[ -n "${!variable_name:-}" ]]; then
    printf '%s\n' "${!variable_name}"
    return
  fi

  if value="$(read_env_value "${WEB_ENV_LOCAL}" "${variable_name}")"; then
    printf '%s\n' "${value}"
    return
  fi

  printf '%s\n' "${default_value}"
}

normalize_base_url() {
  local value="${1%/}"

  if [[ "${value}" == */tools ]]; then
    value="${value%/tools}"
  fi

  printf '%s\n' "${value}"
}

normalize_mcp_url() {
  local value="${1%/}"

  if [[ "${value}" == */tools ]]; then
    printf '%s\n' "${value}"
    return
  fi

  printf '%s/tools\n' "${value}"
}

command_exists() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || [[ -x "${command_name}" ]]
}

read_container_cli_from_moose_config() {
  local config_path="${HOME:-}/.moose/config.toml"

  if [[ -z "${HOME:-}" || ! -f "${config_path}" ]]; then
    return 1
  fi

  awk '
    /^\[dev\]/ { in_dev = 1; next }
    /^\[/ { in_dev = 0 }
    in_dev && /^[[:space:]]*container_cli_path[[:space:]]*=/ {
      line = $0
      sub(/^[[:space:]]*container_cli_path[[:space:]]*=[[:space:]]*"/, "", line)
      sub(/"[[:space:]]*(#.*)?$/, "", line)
      print line
      exit
    }
  ' "${config_path}"
}

resolve_container_cli() {
  if [[ -n "${MOOSE_DEV__CONTAINER_CLI_PATH:-}" ]]; then
    printf '%s\n' "${MOOSE_DEV__CONTAINER_CLI_PATH}"
    return
  fi

  local configured_cli=""
  configured_cli="$(read_container_cli_from_moose_config || true)"
  if [[ -n "${configured_cli}" ]]; then
    printf '%s\n' "${configured_cli}"
    return
  fi
}

container_cli_ready() {
  local cli_path="$1"
  command_exists "${cli_path}" && "${cli_path}" info --format json >/dev/null 2>&1
}

check_container_runtime() {
  if ! command_exists curl; then
    fail "curl is required for readiness checks. Install curl and rerun \`pnpm dev:start\`."
  fi

  local configured_cli=""
  configured_cli="$(resolve_container_cli || true)"
  if [[ -n "${configured_cli}" ]]; then
    CONTAINER_CLI="${configured_cli}"
    export MOOSE_DEV__CONTAINER_CLI_PATH="${CONTAINER_CLI}"

    if ! command_exists "${CONTAINER_CLI}"; then
      fail "Configured container CLI \`${CONTAINER_CLI}\` was not found. Update \`MOOSE_DEV__CONTAINER_CLI_PATH\` or \`~/.moose/config.toml\`, then rerun \`pnpm dev:start\`."
    fi

    if ! container_cli_ready "${CONTAINER_CLI}"; then
      if [[ "$(basename "${CONTAINER_CLI}")" == "finch" ]]; then
        fail "Finch is not running. Start it with \`finch vm start\` and rerun \`pnpm dev:start\`."
      fi

      fail "Docker is not running. Start Docker Desktop or Docker Engine and rerun \`pnpm dev:start\`."
    fi

    log "Using container runtime: $(basename "${CONTAINER_CLI}")"
    return
  fi

  local has_docker=false
  local has_finch=false
  local docker_ready=false
  local finch_ready=false

  if command_exists docker; then
    has_docker=true
    if container_cli_ready docker; then
      docker_ready=true
    fi
  fi

  if command_exists finch; then
    has_finch=true
    if container_cli_ready finch; then
      finch_ready=true
    fi
  fi

  if [[ "${docker_ready}" == true ]]; then
    CONTAINER_CLI="docker"
  elif [[ "${finch_ready}" == true ]]; then
    CONTAINER_CLI="finch"
  elif [[ "${has_docker}" == false && "${has_finch}" == false ]]; then
    fail "Docker or Finch is required for local Moose infrastructure. Install Docker Desktop, Docker Engine, or Finch and rerun \`pnpm dev:start\`."
  elif [[ "${has_docker}" == true && "${has_finch}" == true ]]; then
    fail "Neither Docker nor Finch is running. Start Docker Desktop or Docker Engine, or run \`finch vm start\`, then rerun \`pnpm dev:start\`."
  elif [[ "${has_docker}" == true ]]; then
    fail "Docker is installed but not running. Start Docker Desktop or Docker Engine, or use Finch instead, then rerun \`pnpm dev:start\`."
  else
    fail "Finch is installed but not running. Start it with \`finch vm start\` and rerun \`pnpm dev:start\`."
  fi

  export MOOSE_DEV__CONTAINER_CLI_PATH="${CONTAINER_CLI}"
  log "Using container runtime: $(basename "${CONTAINER_CLI}")"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local ok_codes="$3"
  local timeout_seconds="$4"
  local process_id="$5"
  local start_time
  start_time="$(date +%s)"

  while true; do
    if [[ -n "${process_id}" ]] && ! kill -0 "${process_id}" 2>/dev/null; then
      fail "${name} exited before it became ready. Check the logs above."
    fi

    local status_code=""
    status_code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true)"
    if [[ " ${ok_codes} " == *" ${status_code} "* ]]; then
      log "${name} is ready at ${url}"
      return
    fi

    if (( "$(date +%s)" - start_time >= timeout_seconds )); then
      fail "${name} did not become ready within ${timeout_seconds}s. Check the logs above."
    fi

    sleep 1
  done
}

wait_for_process_exit() {
  while true; do
    if ! kill -0 "${MOOSE_PID}" 2>/dev/null; then
      wait "${MOOSE_PID}"
      return $?
    fi

    if ! kill -0 "${WEB_PID}" 2>/dev/null; then
      wait "${WEB_PID}"
      return $?
    fi

    sleep 1
  done
}

ensure_env_files

if [[ "${PREPARE_ONLY}" == true ]]; then
  log "Prepared local env files only."
  exit 0
fi

check_container_runtime

MOOSE_BASE_URL="$(normalize_base_url "$(resolve_web_env_value "MOOSE_SERVICE_URL" "http://localhost:4000")")"
MOOSE_MCP_URL="$(normalize_mcp_url "$(resolve_web_env_value "MCP_SERVER_URL" "${MOOSE_BASE_URL}")")"

log "Starting Moose service"
(
  cd "${ROOT_DIR}"
  pnpm dev:moose \
    > >(awk '{ print "[moose] " $0; fflush() }') \
    2> >(awk '{ print "[moose] " $0; fflush() }' >&2)
) &
MOOSE_PID="$!"

wait_for_http "Moose infrastructure" "${MOOSE_BASE_URL}/ready" "200" "${MOOSE_TIMEOUT_SECONDS}" "${MOOSE_PID}"
wait_for_http "Moose MCP endpoint" "${MOOSE_MCP_URL}" "200 400 401 405" 30 "${MOOSE_PID}"

log "Starting web app"
(
  cd "${ROOT_DIR}"
  pnpm dev:web \
    > >(awk '{ print "[web] " $0; fflush() }') \
    2> >(awk '{ print "[web] " $0; fflush() }' >&2)
) &
WEB_PID="$!"

wait_for_http "Web app" "${WEB_APP_URL}/api/chat/status" "200" "${WEB_TIMEOUT_SECONDS}" "${WEB_PID}"

log "Local stack is ready."
log "Moose service: ${MOOSE_BASE_URL}"
log "MCP endpoint: ${MOOSE_MCP_URL}"
log "Web app: ${WEB_APP_URL}"
log "Seed starter data in another terminal with: pnpm seed"

wait_for_process_exit
