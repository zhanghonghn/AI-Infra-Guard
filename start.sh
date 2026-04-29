#!/bin/bash

# AI-Infra-Guard 启动脚本
# 创建必要的目录和文件，设置权限，启动服务

set -e

WEB_SERVER_ADDR="${WEB_SERVER_ADDR:-0.0.0.0:8089}"
START_AGENT="${START_AGENT:-auto}" # auto | 1 | true | on | 0 | false | off
WEB_SERVER_PORT="${WEB_SERVER_ADDR##*:}"
KILL_OLD="${KILL_OLD:-false}"

is_truthy() {
	case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
	1|true|on|yes) return 0 ;;
	*) return 1 ;;
	esac
}

is_falsey() {
	case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
	0|false|off|no) return 0 ;;
	*) return 1 ;;
	esac
}

resolve_uv_bin() {
	if [ -n "${AIG_UV_BIN:-}" ] && [ -x "${AIG_UV_BIN}" ]; then
		echo "${AIG_UV_BIN}"
		return 0
	fi

	if command -v uv >/dev/null 2>&1; then
		command -v uv
		return 0
	fi

	for candidate in \
		"${HOME}/.local/bin/uv" \
		"${HOME}/.cargo/bin/uv" \
		"/usr/local/bin/uv" \
		"/usr/bin/uv" \
		"${SCRIPT_DIR}/.venv/bin/uv" \
		"${SCRIPT_DIR}/AIG-PromptSecurity/.venv/bin/uv"; do
		if [ -x "${candidate}" ]; then
			echo "${candidate}"
			return 0
		fi
	done

	return 1
}

python_has_garak() {
	local py="$1"
	[ -x "$py" ] || return 1
	"$py" -c 'import garak' >/dev/null 2>&1
}

# 权限修改失败时提示并继续（例如挂载卷上无法改权限）
warn_or_continue() { echo "Warning: $1" >&2; }

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [ -z "${AIG_PYTHON_BIN:-}" ]; then
	if [ -x "${SCRIPT_DIR}/.venv-garak/bin/python" ]; then
		export AIG_PYTHON_BIN="${SCRIPT_DIR}/.venv-garak/bin/python"
	elif [ -x "${SCRIPT_DIR}/.venv/bin/python" ]; then
		export AIG_PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"
	fi
fi

if [ -z "${AIG_GARAK_PYTHON_BIN:-}" ]; then
	for cand in "${SCRIPT_DIR}/.venv/bin/python" "${SCRIPT_DIR}/.venv-garak/bin/python"; do
		if python_has_garak "$cand"; then
			export AIG_GARAK_PYTHON_BIN="$cand"
			break
		fi
	done
	if [ -z "${AIG_GARAK_PYTHON_BIN:-}" ] && [ -n "${AIG_PYTHON_BIN:-}" ]; then
		export AIG_GARAK_PYTHON_BIN="${AIG_PYTHON_BIN}"
	fi
fi

echo "AIG_PYTHON_BIN=${AIG_PYTHON_BIN:-<unset>}"
echo "AIG_GARAK_PYTHON_BIN=${AIG_GARAK_PYTHON_BIN:-<unset>}"

if [ -n "${SUDO_USER}" ]; then
	USER_HOME="$(eval echo "~${SUDO_USER}")"
else
	USER_HOME="${HOME}"
fi

BASE_DIR="${USER_HOME}/ai-infra-guard"

echo 正在初始化 AI-Infra-Guard 服务...
# 创建必要的目录
mkdir -p "${BASE_DIR}/db" "${BASE_DIR}/uploads" "${BASE_DIR}/logs"

# 设置文件权限
echo 设置文件权限...
chmod 755 "${BASE_DIR}/db" || warn_or_continue "Skip permission change on mounted volume"
chmod 755 "${BASE_DIR}/uploads" || warn_or_continue "Skip permission change on mounted volume"
chmod 755 "${BASE_DIR}/logs" || warn_or_continue "Skip permission change on mounted volume"

# 创建日志文件
echo 初始化日志文件...
touch "${BASE_DIR}/logs/trpc.log"
chmod 644 "${BASE_DIR}/logs/trpc.log"

if UV_BIN="$(resolve_uv_bin 2>/dev/null)"; then
	export AIG_UV_BIN="${UV_BIN}"
	echo "检测到 uv: ${AIG_UV_BIN}"
else
	echo "未检测到 uv，可手动设置 AIG_UV_BIN=/path/to/uv"
fi

BIN_PATH="${SCRIPT_DIR}/ai-infra-guard"
if [ ! -x "${BIN_PATH}" ] && [ -x "${BASE_DIR}/ai-infra-guard" ]; then
	BIN_PATH="${BASE_DIR}/ai-infra-guard"
fi

if [ ! -x "${BIN_PATH}" ] && command -v ai-infra-guard >/dev/null 2>&1; then
	BIN_PATH="$(command -v ai-infra-guard)"
fi

if [ ! -x "${BIN_PATH}" ]; then
	if command -v go >/dev/null 2>&1; then
		REQ_GO_VERSION="$(awk '/^go / {print $2; exit}' "${SCRIPT_DIR}/go.mod" 2>/dev/null)"
		LOCAL_GO_VERSION="$(GOTOOLCHAIN=local go version 2>/dev/null | awk '{print $3}' | sed 's/^go//')"

		if [ -n "${REQ_GO_VERSION}" ] && [ -n "${LOCAL_GO_VERSION}" ] && [ "$(printf '%s\n%s\n' "${REQ_GO_VERSION}" "${LOCAL_GO_VERSION}" | sort -V | head -n1)" != "${REQ_GO_VERSION}" ]; then
			echo "Error: local Go version (${LOCAL_GO_VERSION}) is lower than required (${REQ_GO_VERSION})." >&2
			echo "Please upgrade Go, then run: go build -o ai-infra-guard ./cmd/cli/main.go" >&2
			exit 127
		fi

		echo 未找到 ai-infra-guard 二进制，正在尝试构建...
		if ! (cd "${SCRIPT_DIR}" && GOTOOLCHAIN=local go build -o ai-infra-guard ./cmd/cli/main.go); then
			echo "Error: auto build failed. Please run manually in project root:" >&2
			echo "  GOTOOLCHAIN=local go build -o ai-infra-guard ./cmd/cli/main.go" >&2
			exit 127
		fi
		BIN_PATH="${SCRIPT_DIR}/ai-infra-guard"
	else
		echo "Error: ai-infra-guard not found and Go is not installed." >&2
		exit 127
	fi
fi

AGENT_BIN_PATH="${SCRIPT_DIR}/agent"
if [ ! -x "${AGENT_BIN_PATH}" ] && [ -x "${BASE_DIR}/agent" ]; then
	AGENT_BIN_PATH="${BASE_DIR}/agent"
fi

if [ ! -x "${AGENT_BIN_PATH}" ] && command -v agent >/dev/null 2>&1; then
	AGENT_BIN_PATH="$(command -v agent)"
fi

AGENT_ENABLED="false"
if is_falsey "${START_AGENT}"; then
	AGENT_ENABLED="false"
elif is_truthy "${START_AGENT}"; then
	AGENT_ENABLED="true"
elif [ "$(echo "${START_AGENT}" | tr '[:upper:]' '[:lower:]')" = "auto" ] && [ -x "${AGENT_BIN_PATH}" ]; then
	AGENT_ENABLED="true"
fi

if [ "${AGENT_ENABLED}" = "true" ] && [ ! -x "${AGENT_BIN_PATH}" ]; then
	if command -v go >/dev/null 2>&1; then
		echo 未找到 agent 二进制，正在尝试构建...
		if ! (cd "${SCRIPT_DIR}" && GOTOOLCHAIN=local go build -o agent ./cmd/agent); then
			echo "Error: auto build agent failed. Please run manually in project root:" >&2
			echo "  GOTOOLCHAIN=local go build -o agent ./cmd/agent" >&2
			exit 127
		fi
		AGENT_BIN_PATH="${SCRIPT_DIR}/agent"
	else
		echo "Error: START_AGENT=${START_AGENT}, but agent not found and Go is not installed." >&2
		exit 127
	fi
fi

cleanup() {
	if [ -n "${AGENT_PID:-}" ] && kill -0 "${AGENT_PID}" >/dev/null 2>&1; then
		kill "${AGENT_PID}" >/dev/null 2>&1 || true
	fi
}
trap cleanup EXIT INT TERM

WEB_REUSE_EXISTING="false"
if ss -lnt "( sport = :${WEB_SERVER_PORT} )" 2>/dev/null | grep -q ":${WEB_SERVER_PORT}"; then
	if is_truthy "${KILL_OLD}"; then
		echo "检测到端口 ${WEB_SERVER_PORT} 已被占用，正在清理旧进程..."
		if command -v lsof >/dev/null 2>&1; then
			PIDS="$(lsof -t -iTCP:${WEB_SERVER_PORT} -sTCP:LISTEN 2>/dev/null || true)"
			if [ -n "${PIDS}" ]; then
				kill ${PIDS} 2>/dev/null || true
				sleep 1
			fi
		fi
	fi

	if ss -lnt "( sport = :${WEB_SERVER_PORT} )" 2>/dev/null | grep -q ":${WEB_SERVER_PORT}"; then
		WEB_REUSE_EXISTING="true"
		echo "检测到端口 ${WEB_SERVER_PORT} 已被占用，复用现有 Web 服务。"
	else
		echo 启动AI-Infra-Guard Web 服务（${WEB_SERVER_ADDR}）...
		"${BIN_PATH}" webserver --server "${WEB_SERVER_ADDR}" &
		WEB_PID=$!
	fi
else
	echo 启动AI-Infra-Guard Web 服务（${WEB_SERVER_ADDR}）...
	"${BIN_PATH}" webserver --server "${WEB_SERVER_ADDR}" &
	WEB_PID=$!
fi

if [ "${AGENT_ENABLED}" = "true" ]; then
	AIG_SERVER_ADDR="${AIG_SERVER:-127.0.0.1:${WEB_SERVER_PORT}}"
	if [ -z "${AIG_AGENT_ID:-}" ]; then
		HOST_SHORT="$(hostname 2>/dev/null || echo agent)"
		HOST_SHORT="${HOST_SHORT%%.*}"
		export AIG_AGENT_ID="${HOST_SHORT}-aig-agent-${WEB_SERVER_PORT}"
	fi
	echo 等待 Web 服务就绪后启动 Agent（AIG_SERVER=${AIG_SERVER_ADDR}）...
	for _ in $(seq 1 30); do
		if curl -fsS "http://127.0.0.1:${WEB_SERVER_PORT}/" >/dev/null 2>&1; then
			break
		fi
		sleep 1
	done
	echo "启动 Agent（AIG_AGENT_ID=${AIG_AGENT_ID}）..."
	"${AGENT_BIN_PATH}" --server "${AIG_SERVER_ADDR}" >> "${BASE_DIR}/logs/agent.log" 2>&1 &
	AGENT_PID=$!
	echo Agent 已启动（pid=${AGENT_PID}）
else
	echo Agent 未启用（START_AGENT=${START_AGENT}）
fi

if [ -n "${WEB_PID:-}" ]; then
	wait "${WEB_PID}"
elif [ -n "${AGENT_PID:-}" ]; then
	wait "${AGENT_PID}"
else
	echo "未启动新进程（仅复用现有 Web，且 Agent 未启用）。"
fi