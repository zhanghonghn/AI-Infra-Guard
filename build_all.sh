#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_GO="${BUILD_GO:-true}"
BUILD_FRONTEND="${BUILD_FRONTEND:-true}"
BUILD_PYTHON="${BUILD_PYTHON:-true}"
FRONTEND_INSTALL_DEPS="${FRONTEND_INSTALL_DEPS:-auto}" # auto | true | false

log() {
	echo "[build-all] $*"
}

is_truthy() {
	case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
	1|true|on|yes) return 0 ;;
	*) return 1 ;;
	esac
}

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "[build-all] missing command: $1" >&2
		exit 1
	fi
}

build_go_binaries() {
	require_cmd go
	log "开始编译 Go 二进制..."
	CGO_ENABLED=0 go build -ldflags='-s -w' -trimpath -buildvcs=false -o ai-infra-guard ./cmd/cli/main.go
	CGO_ENABLED=0 go build -ldflags='-s -w' -trimpath -buildvcs=false -o agent ./cmd/agent
	CGO_ENABLED=0 go build -ldflags='-s -w' -trimpath -buildvcs=false -o yamlcheck ./cmd/yamlcheck/main.go
	log "Go 编译完成: ai-infra-guard, agent, yamlcheck"
}

build_frontend() {
	if [ ! -d "$SCRIPT_DIR/frontend" ]; then
		log "未检测到 frontend 目录，跳过前端构建"
		return 0
	fi

	require_cmd npm
	log "开始构建前端..."
	pushd "$SCRIPT_DIR/frontend" >/dev/null

	INSTALL_DEPS="false"
	if is_truthy "$FRONTEND_INSTALL_DEPS"; then
		INSTALL_DEPS="true"
	elif [ "$(echo "$FRONTEND_INSTALL_DEPS" | tr '[:upper:]' '[:lower:]')" = "auto" ] && [ ! -d node_modules ]; then
		INSTALL_DEPS="true"
	fi

	if [ "$INSTALL_DEPS" = "true" ]; then
		if [ -f package-lock.json ]; then
			log "执行 npm ci..."
			npm ci
		else
			log "执行 npm install..."
			npm install
		fi
	fi

	npm run build
	popd >/dev/null
	log "前端构建完成"
}

compile_python_tree() {
	local py_bin="$1"
	local target_dir="$2"

	if [ -d "$target_dir" ]; then
		log "Python 语法编译检查: ${target_dir#$SCRIPT_DIR/}"
		"$py_bin" -m compileall -q "$target_dir"
	fi
}

build_python_projects() {
	local py_bin="${AIG_PYTHON_BIN:-}"
	if [ -z "$py_bin" ]; then
		if command -v python3 >/dev/null 2>&1; then
			py_bin="$(command -v python3)"
		elif command -v python >/dev/null 2>&1; then
			py_bin="$(command -v python)"
		else
			echo "[build-all] 未找到 python3/python，无法执行 Python 编译检查" >&2
			exit 1
		fi
	fi

	log "使用 Python: $py_bin"
	compile_python_tree "$py_bin" "$SCRIPT_DIR/agent-scan"
	compile_python_tree "$py_bin" "$SCRIPT_DIR/mcp-scan"
	compile_python_tree "$py_bin" "$SCRIPT_DIR/AIG-PromptSecurity"
	compile_python_tree "$py_bin" "$SCRIPT_DIR/garak-adapter"
	log "Python 编译检查完成"
}

log "工作目录: $SCRIPT_DIR"

if is_truthy "$BUILD_GO"; then
	build_go_binaries
else
	log "已跳过 Go 编译（BUILD_GO=$BUILD_GO）"
fi

if is_truthy "$BUILD_FRONTEND"; then
	build_frontend
else
	log "已跳过前端构建（BUILD_FRONTEND=$BUILD_FRONTEND）"
fi

if is_truthy "$BUILD_PYTHON"; then
	build_python_projects
else
	log "已跳过 Python 编译检查（BUILD_PYTHON=$BUILD_PYTHON）"
fi

log "全部编译流程完成 ✅"
