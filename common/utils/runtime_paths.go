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
	// 相对当前工作目录和可执行文件目录搜索
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

func ResolveUvBin() (string, error) {
	if override := strings.TrimSpace(os.Getenv(UvBinEnv)); override != "" {
		return override, nil
	}
	if uvPath, err := exec.LookPath("uv"); err == nil {
		return uvPath, nil
	}
	const containerUvPath = "/usr/local/bin/uv"
	if info, err := os.Stat(containerUvPath); err == nil && !info.IsDir() {
		return containerUvPath, nil
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
