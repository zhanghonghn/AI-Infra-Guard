#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
	exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

WEB_SERVER_ADDR="${WEB_SERVER_ADDR:-127.0.0.1:8089}"
START_AGENT="${START_AGENT:-true}"
AUTO_BUILD="${AUTO_BUILD:-true}"
KILL_OLD="${KILL_OLD:-false}"

if [ -z "${AIG_PYTHON_BIN:-}" ]; then
	if [ -x "${SCRIPT_DIR}/.venv-garak/bin/python" ]; then
		export AIG_PYTHON_BIN="${SCRIPT_DIR}/.venv-garak/bin/python"
	elif [ -x "${SCRIPT_DIR}/.venv/bin/python" ]; then
		export AIG_PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"
	fi
fi

python_has_garak() {
	local py="$1"
	[ -x "$py" ] || return 1
	"$py" -c 'import garak' >/dev/null 2>&1
}

if [ -z "${AIG_GARAK_PYTHON_BIN:-}" ]; then
	# 优先本地虚拟环境（.venv -> .venv-garak），并确保可 import garak
	for cand in "${SCRIPT_DIR}/.venv/bin/python" "${SCRIPT_DIR}/.venv-garak/bin/python"; do
		if python_has_garak "$cand"; then
			export AIG_GARAK_PYTHON_BIN="$cand"
			break
		fi
	done

	# 若上述环境未安装 garak，则退回到已配置解释器（后续由 Go 侧再严格校验）
	if [ -z "${AIG_GARAK_PYTHON_BIN:-}" ] && [ -n "${AIG_PYTHON_BIN:-}" ]; then
		export AIG_GARAK_PYTHON_BIN="${AIG_PYTHON_BIN}"
	fi
fi

echo "[dev] AIG_PYTHON_BIN=${AIG_PYTHON_BIN:-<unset>}"
echo "[dev] AIG_GARAK_PYTHON_BIN=${AIG_GARAK_PYTHON_BIN:-<unset>}"

PORT="${WEB_SERVER_ADDR##*:}"
AIG_SERVER_ADDR="${AIG_SERVER:-127.0.0.1:${PORT}}"

is_truthy() {
	case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
	1|true|on|yes) return 0 ;;
	*) return 1 ;;
	esac
}

ensure_binary() {
	local bin_name="$1"
	local build_cmd="$2"
	if [ -x "./${bin_name}" ]; then
		return 0
	fi
	if ! is_truthy "$AUTO_BUILD"; then
		echo "[dev] missing binary: ${bin_name} (set AUTO_BUILD=true to build automatically)" >&2
		exit 1
	fi
	if ! command -v go >/dev/null 2>&1; then
		echo "[dev] go not found, cannot auto build ${bin_name}" >&2
		exit 1
	fi
	echo "[dev] building ${bin_name} ..."
	eval "$build_cmd"
}

port_in_use() {
	ss -lnt "( sport = :${PORT} )" 2>/dev/null | grep -q ":${PORT}"
}

kill_port_processes() {
	if command -v lsof >/dev/null 2>&1; then
		local pids
		pids="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
		if [ -n "${pids}" ]; then
			echo "[dev] killing processes on port ${PORT}: ${pids}"
			kill ${pids} 2>/dev/null || true
			sleep 1
		fi
	fi
}

cleanup() {
	if [ -n "${AGENT_PID:-}" ] && kill -0 "${AGENT_PID}" >/dev/null 2>&1; then
		echo "[dev] stopping agent pid=${AGENT_PID}"
		kill "${AGENT_PID}" >/dev/null 2>&1 || true
	fi
	if [ -n "${WEB_PID:-}" ] && kill -0 "${WEB_PID}" >/dev/null 2>&1; then
		echo "[dev] stopping webserver pid=${WEB_PID}"
		kill "${WEB_PID}" >/dev/null 2>&1 || true
	fi
}
trap cleanup EXIT INT TERM

ensure_binary "ai-infra-guard" "go build -o ai-infra-guard ./cmd/cli/main.go"

if is_truthy "$START_AGENT"; then
	ensure_binary "agent" "go build -o agent ./cmd/agent"
fi

if port_in_use; then
	if is_truthy "$KILL_OLD"; then
		kill_port_processes
	fi
fi

if port_in_use; then
	echo "[dev] port ${PORT} is already in use."
	echo "[dev] Either stop old process, or run with KILL_OLD=true, or change WEB_SERVER_ADDR."
	exit 1
fi

if is_truthy "$START_AGENT"; then
	echo "[dev] starting webserver on ${WEB_SERVER_ADDR} (background for readiness check)"
	APP_ENV=development ./ai-infra-guard webserver --server "${WEB_SERVER_ADDR}" &
	WEB_PID=$!

	echo "[dev] waiting for webserver readiness..."
	for _ in $(seq 1 30); do
		if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
			break
		fi
		sleep 1
	done

	if ! curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
		echo "[dev] webserver did not become ready in time" >&2
		exit 1
	fi

	if [ -z "${AIG_AGENT_ID:-}" ]; then
		HOST_SHORT="$(hostname 2>/dev/null || echo agent)"
		HOST_SHORT="${HOST_SHORT%%.*}"
		export AIG_AGENT_ID="${HOST_SHORT}-aig-agent-${PORT}"
	fi
	echo "[dev] starting agent: AIG_SERVER=${AIG_SERVER_ADDR}, AIG_AGENT_ID=${AIG_AGENT_ID}"
	AIG_SERVER="${AIG_SERVER_ADDR}" ./agent &
	AGENT_PID=$!
	echo "[dev] agent started pid=${AGENT_PID}"

	echo "[dev] webserver running in foreground (pid=${WEB_PID})"
	wait "${WEB_PID}"
else
	echo "[dev] starting webserver on ${WEB_SERVER_ADDR} (foreground)"
	APP_ENV=development ./ai-infra-guard webserver --server "${WEB_SERVER_ADDR}"
fi
