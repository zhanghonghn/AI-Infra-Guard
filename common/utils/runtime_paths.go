package utils

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	AgentScanDirEnv       = "AIG_AGENT_SCAN_DIR"
	McpScanDirEnv         = "AIG_MCP_SCAN_DIR"
	PromptSecurityDirEnv  = "AIG_PROMPT_SECURITY_DIR"
	GarakAdapterDirEnv    = "AIG_GARAK_ADAPTER_DIR"
	GarakPoliciesDirEnv   = "AIG_GARAK_POLICIES_DIR"
	GarakPythonBinEnv     = "AIG_GARAK_PYTHON_BIN"
	PythonBinEnv          = "AIG_PYTHON_BIN"
	UvBinEnv              = "AIG_UV_BIN"
)

func ResolveAgentScanDir() (string, error) {
	return resolveRuntimeDir(AgentScanDirEnv, "/app/agent-scan", "agent-scan")
}

func ResolveMcpScanDir() (string, error) {
	return resolveRuntimeDir(McpScanDirEnv, "/app/mcp-scan", "mcp-scan")
}

func ResolvePromptSecurityDir() (string, error) {
	return resolveRuntimeDir(PromptSecurityDirEnv, "/app/AIG-PromptSecurity", "AIG-PromptSecurity")
}

// ResolveGarakAdapterDir 解析 garak-adapter 目录路径
func ResolveGarakAdapterDir() (string, error) {
	return resolveRuntimeDir(GarakAdapterDirEnv, "/app/garak-adapter", "garak-adapter")
}

// ResolveGarakPoliciesDir 解析 Garak 策略配置目录路径
func ResolveGarakPoliciesDir() (string, error) {
	// 优先环境变量，其次相对路径
	candidates := []string{}
	if override := strings.TrimSpace(os.Getenv(GarakPoliciesDirEnv)); override != "" {
		candidates = append(candidates, override)
	}
	candidates = append(candidates, "/app/data/garak_policies")
	// 从当前目录和可执行文件目录开始，向上查找 data/garak_policies 目录，最多查找 8 层
	for _, base := range runtimeSearchBases() {
		for cur := base; ; cur = filepath.Dir(cur) {
			candidates = append(candidates, filepath.Join(cur, "data", "garak_policies"))
			if filepath.Dir(cur) == cur {
				break
			}
		}
	}
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		info, err := os.Stat(c)
		if err == nil && info.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("找不到 garak_policies 目录; 可通过环境变量 %s 指定", GarakPoliciesDirEnv)
}

// ResolvePythonBin 解析 Python 解释器路径
func ResolvePythonBin() (string, error) {
	if override := strings.TrimSpace(os.Getenv(PythonBinEnv)); override != "" {
		return override, nil
	}
	for _, name := range []string{"python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("找不到 Python 解释器; 可通过环境变量 %s 指定路径", PythonBinEnv)
}

// ResolveGarakPythonBin 解析 Garak 专用 Python 解释器。
// 规则：优先使用本地 .venv/.venv-garak 中可 import garak 的解释器，
// 其次使用环境变量指定解释器；若都不可用则返回明确错误。
func ResolveGarakPythonBin() (string, error) {
	var candidates []string
	seen := make(map[string]struct{})
	add := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		if _, ok := seen[path]; ok {
			return
		}
		seen[path] = struct{}{}
		candidates = append(candidates, path)
	}

	// 优先：Garak 专用覆盖
	add(os.Getenv(GarakPythonBinEnv))
	// 次优先：通用 Python 覆盖
	add(os.Getenv(PythonBinEnv))

	// 本地虚拟环境优先（按用户诉求：优先 .venv）
	for _, base := range runtimeSearchBases() {
		base = strings.TrimSpace(base)
		if base == "" {
			continue
		}
		current := filepath.Clean(base)
		for i := 0; i < 8; i++ {
			add(filepath.Join(current, ".venv", "bin", "python"))
			add(filepath.Join(current, ".venv-garak", "bin", "python"))
			parent := filepath.Dir(current)
			if parent == current {
				break
			}
			current = parent
		}
	}

	// 最后兜底系统解释器
	if p, err := exec.LookPath("python3"); err == nil {
		add(p)
	}
	if p, err := exec.LookPath("python"); err == nil {
		add(p)
	}

	for _, candidate := range candidates {
		if !pythonHasModule(candidate, "garak") {
			continue
		}
		return candidate, nil
	}

	return "", fmt.Errorf("找不到可用的 Garak Python 解释器；请在本地 .venv/.venv-garak 安装 garak，或通过 %s 指定", GarakPythonBinEnv)
}

func pythonHasModule(pythonBin, module string) bool {
	if strings.TrimSpace(pythonBin) == "" || strings.TrimSpace(module) == "" {
		return false
	}
	cmd := exec.Command(pythonBin, "-c", fmt.Sprintf("import %s", module))
	return cmd.Run() == nil
}

func ResolveUvBin() (string, error) {
	if override := strings.TrimSpace(os.Getenv(UvBinEnv)); override != "" {
		if filepath.IsAbs(override) {
			if info, err := os.Stat(override); err == nil && !info.IsDir() {
				return override, nil
			}
		}
		if uvPath, err := exec.LookPath(override); err == nil {
			return uvPath, nil
		}
	}
	if uvPath, err := exec.LookPath("uv"); err == nil {
		return uvPath, nil
	}

	candidates := []string{
		"/usr/local/bin/uv",
		"/usr/bin/uv",
	}

	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "uv"),
			filepath.Join(home, ".cargo", "bin", "uv"),
		)
	}

	for _, base := range runtimeSearchBases() {
		base = strings.TrimSpace(base)
		if base == "" {
			continue
		}
		current := filepath.Clean(base)
		for i := 0; i < 8; i++ {
			candidates = append(candidates,
				filepath.Join(current, ".venv", "bin", "uv"),
				filepath.Join(current, "AIG-PromptSecurity", ".venv", "bin", "uv"),
			)
			parent := filepath.Dir(current)
			if parent == current {
				break
			}
			current = parent
		}
	}

	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}

		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("unable to locate uv; set %s to override the path", UvBinEnv)
}

func resolveRuntimeDir(envName, containerPath, relativePath string) (string, error) {
	candidates := collectRuntimeDirCandidates(envName, containerPath, relativePath, runtimeSearchBases()...)
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("unable to locate %s; set %s to override the path", relativePath, envName)
}

func runtimeSearchBases() []string {
	var bases []string
	if wd, err := os.Getwd(); err == nil {
		bases = append(bases, wd)
	}
	if execPath, err := os.Executable(); err == nil {
		bases = append(bases, filepath.Dir(execPath))
	}
	return bases
}

func collectRuntimeDirCandidates(envName, containerPath, relativePath string, bases ...string) []string {
	var candidates []string
	seen := make(map[string]struct{})
	addCandidate := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		path = filepath.Clean(path)
		if !filepath.IsAbs(path) {
			if absPath, err := filepath.Abs(path); err == nil {
				path = absPath
			}
		}
		if _, ok := seen[path]; ok {
			return
		}
		seen[path] = struct{}{}
		candidates = append(candidates, path)
	}

	addCandidate(os.Getenv(envName))
	addCandidate(containerPath)

	for _, base := range bases {
		base = strings.TrimSpace(base)
		if base == "" {
			continue
		}
		current := filepath.Clean(base)
		for i := 0; i < 8; i++ {
			addCandidate(filepath.Join(current, relativePath))
			parent := filepath.Dir(current)
			if parent == current {
				break
			}
			current = parent
		}
	}

	return candidates
}
