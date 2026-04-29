// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package agent

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"

	garakpkg "github.com/Tencent/AI-Infra-Guard/internal/garak"
	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
)

// ---------------- 文案/语言相关 ----------------

func TestGarakTaskTitles(t *testing.T) {
	cases := []struct {
		name     string
		language string
		wantZh   bool
	}{
		{"zh", "zh", true},
		{"zh_CN mixed case", "ZH_cn", true},
		{"empty defaults to en in this helper", "", false},
		{"en explicit", "en", false},
		{"unknown falls back to en", "fr", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			titles := garakTaskTitles(c.language)
			if len(titles) != 3 {
				t.Fatalf("expected 3 step titles, got %d", len(titles))
			}
			isZh := strings.Contains(titles[0], "初始化")
			if isZh != c.wantZh {
				t.Errorf("language=%q expected zh=%v, got titles=%v", c.language, c.wantZh, titles)
			}
		})
	}
}

func TestGarakInitDoneTitle(t *testing.T) {
	if got := garakInitDoneTitle("zh"); got != "初始化完成" {
		t.Errorf("zh: unexpected %q", got)
	}
	if got := garakInitDoneTitle("ZH_CN"); got != "初始化完成" {
		t.Errorf("zh_cn: unexpected %q", got)
	}
	if got := garakInitDoneTitle("en"); got != "Initialization completed" {
		t.Errorf("en: unexpected %q", got)
	}
	if got := garakInitDoneTitle(""); got != "Initialization completed" {
		t.Errorf("empty should fallback to en, got %q", got)
	}
}

func TestHydrateGarakParams_FromNestedModel(t *testing.T) {
	raw := map[string]interface{}{
		"model": map[string]interface{}{
			"model":    "hunyuan-turbos-latest",
			"token":    "sk-IgPTRm19zBXsF4qy2e60917cCeF04750A63b1e9aD46e1c31",
			"base_url": "https://api.ocoolai.com/v1",
		},
	}
	b, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal raw params failed: %v", err)
	}

	params := &GarakScanParams{}
	hydrateGarakParams(b, params)

	if params.ModelName != "hunyuan-turbos-latest" {
		t.Errorf("unexpected model name: %q", params.ModelName)
	}
	if params.APIKey != "sk-IgPTRm19zBXsF4qy2e60917cCeF04750A63b1e9aD46e1c31" {
		t.Errorf("unexpected api key: %q", params.APIKey)
	}
	if params.BaseURL != "https://api.ocoolai.com/v1" {
		t.Errorf("unexpected base url: %q", params.BaseURL)
	}
	if params.ModelProvider != "openai" {
		t.Errorf("unexpected provider: %q", params.ModelProvider)
	}
}

func TestHydrateGarakParams_KeepExplicitValues(t *testing.T) {
	raw := map[string]interface{}{
		"model": map[string]interface{}{
			"model":    "x",
			"token":    "y",
			"base_url": "http://localhost:11434/v1",
		},
	}
	b, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal raw params failed: %v", err)
	}

	params := &GarakScanParams{
		ModelProvider: "custom",
		ModelName:     "manual-model",
		APIKey:        "manual-token",
		BaseURL:       "https://manual.example/v1",
	}
	hydrateGarakParams(b, params)

	if params.ModelProvider != "custom" || params.ModelName != "manual-model" || params.APIKey != "manual-token" || params.BaseURL != "https://manual.example/v1" {
		t.Fatalf("explicit values should not be overridden, got %+v", params)
	}
}

func TestInferModelProvider(t *testing.T) {
	cases := []struct {
		name    string
		baseURL string
		want    string
	}{
		{name: "azure", baseURL: "https://xxx.openai.azure.com", want: "azure"},
		{name: "ollama by port", baseURL: "http://127.0.0.1:11434/v1", want: "ollama"},
		{name: "custom localhost", baseURL: "http://localhost:8000/v1", want: "custom"},
		{name: "openai default", baseURL: "https://api.openai.com/v1", want: "openai"},
		{name: "empty default", baseURL: "", want: "openai"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := inferModelProvider(c.baseURL)
			if got != c.want {
				t.Fatalf("inferModelProvider(%q)=%q want %q", c.baseURL, got, c.want)
			}
		})
	}
}

// ---------------- exitCodeFromError ----------------

func TestExitCodeFromError(t *testing.T) {
	if code := exitCodeFromError(nil); code != 0 {
		t.Errorf("nil err should yield 0, got %d", code)
	}
	// 普通错误返回 -1
	if code := exitCodeFromError(errors.New("boom")); code != -1 {
		t.Errorf("plain err should yield -1, got %d", code)
	}
	// 真正构造一个 *exec.ExitError —— 通过执行一个必然失败的命令
	cmd := exec.Command(falseCmd())
	err := cmd.Run()
	if err == nil {
		t.Fatalf("expected %s to exit non-zero", falseCmd())
	}
	code := exitCodeFromError(err)
	if code <= 0 {
		t.Errorf("ExitError should produce positive exit code, got %d (err=%v)", code, err)
	}
}

// falseCmd 返回一个在当前平台上必然失败退出的命令。
func falseCmd() string {
	if runtime.GOOS == "windows" {
		// cmd /c exit 1 的等价：用 cmd.exe 执行一个失败命令；为简化测试统一跳过 windows
		return "cmd"
	}
	return "false"
}

// ---------------- buildAdapterFailureDetail ----------------

func TestBuildAdapterFailureDetail(t *testing.T) {
	t.Run("metadata.error 优先", func(t *testing.T) {
		parsed := &garakpkg.AdapterOutput{
			Metadata: garakpkg.OutputMeta{Error: "Garak 未安装"},
		}
		got := buildAdapterFailureDetail(errors.New("exit status 2"), parsed, nil)
		if got != "Garak 未安装" {
			t.Errorf("expected metadata.error to win, got %q", got)
		}
	})
	t.Run("parseErr 与 runErr 拼接", func(t *testing.T) {
		got := buildAdapterFailureDetail(errors.New("exit status 2"), nil, errors.New("no json"))
		if !strings.Contains(got, "exit status 2") || !strings.Contains(got, "no json") {
			t.Errorf("expected combined message, got %q", got)
		}
	})
	t.Run("仅 runErr", func(t *testing.T) {
		got := buildAdapterFailureDetail(errors.New("exit status 2"), nil, nil)
		if got != "exit status 2" {
			t.Errorf("expected runErr.Error(), got %q", got)
		}
	})
	t.Run("全部 nil 走未知错误", func(t *testing.T) {
		if got := buildAdapterFailureDetail(nil, nil, nil); got != "未知错误" {
			t.Errorf("expected fallback, got %q", got)
		}
	})
	t.Run("空白 metadata.error 不算命中", func(t *testing.T) {
		parsed := &garakpkg.AdapterOutput{Metadata: garakpkg.OutputMeta{Error: "   "}}
		got := buildAdapterFailureDetail(errors.New("real reason"), parsed, nil)
		if got != "real reason" {
			t.Errorf("expected runErr to win when metadata.error is whitespace, got %q", got)
		}
	})
	t.Run("unknown probes 给出版本不兼容提示", func(t *testing.T) {
		parsed := &garakpkg.AdapterOutput{Metadata: garakpkg.OutputMeta{Error: "❌Unknown probes❌: promptinject.HijackHateHumanized,lmrc.Deadnames"}}
		got := buildAdapterFailureDetail(errors.New("exit status 2"), parsed, nil)
		if !strings.Contains(got, "探针与当前版本不兼容") {
			t.Fatalf("expected version mismatch hint, got %q", got)
		}
		if !strings.Contains(got, "Unknown probes") {
			t.Fatalf("expected raw detail retained, got %q", got)
		}
	})
	t.Run("API key 缺失给出凭证提示", func(t *testing.T) {
		raw := "Garak 子进程未生成报告文件 (rc=0)；最后输出: Put the OpenAI API key in the OPENAI_API_KEY environment variable"
		got := buildAdapterFailureDetail(errors.New(raw), nil, nil)
		if !strings.Contains(got, "模型凭证缺失或无效") {
			t.Fatalf("expected credential hint, got %q", got)
		}
	})
}

func TestSummarizeFailureBrief(t *testing.T) {
	t.Run("空字符串回退", func(t *testing.T) {
		if got := summarizeFailureBrief("   "); got != "扫描失败" {
			t.Fatalf("unexpected fallback brief: %q", got)
		}
	})
	t.Run("长文本截断", func(t *testing.T) {
		long := strings.Repeat("a", 120)
		got := summarizeFailureBrief(long)
		if len(got) > 75 || !strings.HasSuffix(got, "...") {
			t.Fatalf("expected truncated brief, got %q", got)
		}
	})
	t.Run("多空格归一化", func(t *testing.T) {
		got := summarizeFailureBrief("凭证   缺失\n请检查")
		if got != "凭证 缺失 请检查" {
			t.Fatalf("unexpected normalized brief: %q", got)
		}
	})
}

// ---------------- buildAdapterArgv ----------------

func TestBuildAdapterArgv(t *testing.T) {
	probes := []string{"dan.Dan_11_0", "promptinject.HijackHateHumans"}
	t.Run("无 BaseURL 不透传", func(t *testing.T) {
		argv := buildAdapterArgv("/opt/garak-adapter", "scan-1", GarakScanParams{
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
			Intensity:     "fast",
		}, probes)
		joined := strings.Join(argv, " ")
		if !strings.HasSuffix(argv[0], "/main.py") {
			t.Errorf("first arg should be adapter main.py, got %s", argv[0])
		}
		if !strings.Contains(joined, "--scan-id scan-1") ||
			!strings.Contains(joined, "--model-provider openai") ||
			!strings.Contains(joined, "--model-name gpt-4o") ||
			!strings.Contains(joined, "--probe-groups dan.Dan_11_0,promptinject.HijackHateHumans") ||
			!strings.Contains(joined, "--output-format json") {
			t.Errorf("missing required args: %s", joined)
		}
		if strings.Contains(joined, "--base-url") {
			t.Errorf("base-url should be omitted when empty, got %s", joined)
		}
	})

	t.Run("旧探针名自动兼容映射", func(t *testing.T) {
		legacyProbes := []string{"promptinject.HijackHateHumanized", "lmrc.Deadnames"}
		argv := buildAdapterArgv("/opt/garak-adapter", "scan-legacy", GarakScanParams{}, legacyProbes)
		joined := strings.Join(argv, " ")
		if !strings.Contains(joined, "--probe-groups promptinject.HijackHateHumans,lmrc.Deadnaming") {
			t.Errorf("legacy probes should be normalized, got: %s", joined)
		}
	})

	t.Run("空白 BaseURL 视为未提供", func(t *testing.T) {
		argv := buildAdapterArgv("/opt/garak-adapter", "scan-2", GarakScanParams{BaseURL: "   "}, probes)
		if strings.Contains(strings.Join(argv, " "), "--base-url") {
			t.Errorf("whitespace base-url should be omitted")
		}
	})

	t.Run("显式 BaseURL 透传", func(t *testing.T) {
		argv := buildAdapterArgv("/opt/garak-adapter", "scan-3", GarakScanParams{BaseURL: "http://localhost:11434/v1"}, probes)
		joined := strings.Join(argv, " ")
		if !strings.Contains(joined, "--base-url http://localhost:11434/v1") {
			t.Errorf("base-url not forwarded: %s", joined)
		}
	})

	t.Run("API key 不应出现在 argv", func(t *testing.T) {
		argv := buildAdapterArgv("/opt/garak-adapter", "scan-4", GarakScanParams{
			APIKey: "sk-secret-should-not-leak",
		}, probes)
		for _, a := range argv {
			if strings.Contains(a, "sk-secret-should-not-leak") {
				t.Fatalf("API key leaked in argv: %s", a)
			}
		}
	})
}

func TestNormalizeProbeGroups(t *testing.T) {
	input := []string{" promptinject.HijackHateHumanized ", "lmrc.Deadnames", "dan.Dan_11_0", ""}
	got := normalizeProbeGroups(input)
	want := []string{"promptinject.HijackHateHumans", "lmrc.Deadnaming", "dan.Dan_11_0"}
	if len(got) != len(want) {
		t.Fatalf("length mismatch: got %d want %d, got=%v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected value at %d: got %q want %q", i, got[i], want[i])
		}
	}
}

// ---------------- parseAdapterOutput ----------------

func TestParseAdapterOutput(t *testing.T) {
	t.Run("最后一行是合法 JSON", func(t *testing.T) {
		lines := []string{
			"loading garak...",
			"running probe dan.Dan_11_0",
			`{"adapter_version":"1.0.0","scan_id":"s","success":true}`,
		}
		out, err := parseAdapterOutput(lines)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if out.ScanID != "s" || out.AdapterVersion != "1.0.0" {
			t.Errorf("unexpected parsed: %+v", out)
		}
	})

	t.Run("末尾有非 JSON 行时跳过", func(t *testing.T) {
		lines := []string{
			`{"adapter_version":"1.0.0","scan_id":"s2"}`,
			"goodbye",
		}
		out, err := parseAdapterOutput(lines)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if out.ScanID != "s2" {
			t.Errorf("unexpected scan id: %+v", out)
		}
	})

	t.Run("无 JSON 报错", func(t *testing.T) {
		_, err := parseAdapterOutput([]string{"hello", "world"})
		if err == nil {
			t.Fatal("expected error when no json present")
		}
		if !strings.Contains(err.Error(), "未找到合法的 JSON") {
			t.Errorf("unexpected message: %v", err)
		}
	})

	t.Run("非法 JSON 行被跳过且最终报错", func(t *testing.T) {
		_, err := parseAdapterOutput([]string{"{not json", "{also bad"})
		if err == nil {
			t.Fatal("expected error when only malformed json")
		}
	})
}

// ---------------- defaultThresholds & resolveProbeGroups ----------------

func TestDefaultThresholds_NoPolicyDir(t *testing.T) {
	got := defaultThresholds("", "fast")
	if got.Critical != 0.2 || got.High != 0.4 || got.Medium != 0.7 {
		t.Errorf("unexpected fallback thresholds: %+v", got)
	}
}

func TestDefaultThresholds_EmptyIntensity(t *testing.T) {
	got := defaultThresholds("/nonexistent", "")
	if got.Critical != 0.2 {
		t.Errorf("unexpected fallback thresholds: %+v", got)
	}
}

func TestResolveProbeGroups_FallbackToDefault(t *testing.T) {
	probes, err := resolveProbeGroups("fast", "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(probes) != len(defaultFastProbes) {
		t.Errorf("expected default fast probes, got %v", probes)
	}
}

func TestResolveProbeGroups_EmptyIntensity(t *testing.T) {
	probes, err := resolveProbeGroups("", "/some/dir")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(probes) != len(defaultFastProbes) {
		t.Errorf("expected default probes when intensity empty, got %v", probes)
	}
}

// ---------------- buildGarakResult ----------------

func TestBuildGarakResult_SeverityCounting(t *testing.T) {
	output := &garakpkg.AdapterOutput{
		AdapterVersion: "1.0.0",
		GarakVersion:   "0.10.0",
		Metadata: garakpkg.OutputMeta{
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
		},
	}
	findings := []engine.Finding{
		{Severity: engine.SeverityCritical},
		{Severity: engine.SeverityHigh},
		{Severity: engine.SeverityHigh},
		{Severity: engine.SeverityMedium},
		{Severity: engine.SeverityLow},
		{Severity: engine.SeverityInfo},
	}
	result := buildGarakResult("scan-x", output, findings)

	if result["scan_id"] != "scan-x" {
		t.Errorf("scan_id mismatch: %v", result["scan_id"])
	}
	if result["total"].(int) != len(findings) {
		t.Errorf("total mismatch: %v", result["total"])
	}
	summary, ok := result["summary"].(map[string]interface{})
	if !ok {
		t.Fatalf("summary should be map[string]interface{}, got %T", result["summary"])
	}
	if summary["total_findings"].(int) != len(findings) {
		t.Errorf("summary.total_findings mismatch: %v", summary["total_findings"])
	}
	if summary["total"].(int) != len(findings) {
		t.Errorf("summary.total mismatch: %v", summary["total"])
	}
	if _, ok := result["results"].([]engine.Finding); !ok {
		t.Fatalf("results should be []engine.Finding, got %T", result["results"])
	}
	if result["garak_version"] != "0.10.0" {
		t.Errorf("garak_version not propagated: %v", result["garak_version"])
	}
	bs, ok := result["by_severity"].(map[string]int)
	if !ok {
		t.Fatalf("by_severity should be map[string]int, got %T", result["by_severity"])
	}
	want := map[string]int{"critical": 1, "high": 2, "medium": 1, "low": 1, "info": 1}
	for k, v := range want {
		if bs[k] != v {
			t.Errorf("by_severity[%s] expected %d, got %d", k, v, bs[k])
		}
	}
}

func TestBuildGarakResult_NoFindings(t *testing.T) {
	output := &garakpkg.AdapterOutput{}
	result := buildGarakResult("scan-empty", output, nil)
	if result["total"].(int) != 0 {
		t.Errorf("total should be 0, got %v", result["total"])
	}
	summary := result["summary"].(map[string]interface{})
	if summary["total_findings"].(int) != 0 {
		t.Errorf("summary.total_findings should be 0, got %v", summary["total_findings"])
	}
	if summary["total"].(int) != 0 {
		t.Errorf("summary.total should be 0, got %v", summary["total"])
	}
	bs := result["by_severity"].(map[string]int)
	for _, sev := range []string{"critical", "high", "medium", "low", "info"} {
		if bs[sev] != 0 {
			t.Errorf("by_severity[%s] should be 0, got %d", sev, bs[sev])
		}
	}
}

// ---------------- sanitizeForFilename ----------------

func TestSanitizeForFilename(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "scan"},
		{"abc-123_XYZ", "abc-123_XYZ"},
		{"a/b\\c", "a_b_c"},
		{"../../etc/passwd", "______etc_passwd"},
		{"中文 id", "___id"}, // 每个中文字符是一个 rune，连同空格都被替换为下划线
		{"!!!", "___"},
	}
	for _, c := range cases {
		if got := sanitizeForFilename(c.in); got != c.want {
			t.Errorf("sanitizeForFilename(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ---------------- persistGarakReport ----------------

func TestPersistGarakReport_EmptyContent(t *testing.T) {
	_, _, err := persistGarakReport("", "scan-1", "")
	if err == nil {
		t.Fatal("expected error for empty content")
	}
	if !strings.Contains(err.Error(), "空报告内容") {
		t.Errorf("unexpected err: %v", err)
	}
	_, _, err = persistGarakReport("", "scan-1", "   \n")
	if err == nil {
		t.Fatal("whitespace-only content should also be rejected")
	}
}

func TestPersistGarakReport_NoServerKeepsLocalFile(t *testing.T) {
	content := "# garak report\nhello"
	path, info, err := persistGarakReport("", "scan-local", content)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if info != nil {
		t.Errorf("expected nil upload info when no server, got %+v", info)
	}
	if path == "" {
		t.Fatal("expected non-empty local report path")
	}
	defer os.Remove(path)

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back failed: %v", err)
	}
	if string(data) != content {
		t.Errorf("file content mismatch: %q", string(data))
	}
	if !strings.Contains(path, "garak-report-scan-local") {
		t.Errorf("temp file pattern should include sanitized scan id, got %s", path)
	}
}

func TestPersistGarakReport_SanitizesScanIDInFilename(t *testing.T) {
	// scanID 含路径字符，应被 sanitizeForFilename 清洗，避免 CreateTemp 报错
	path, _, err := persistGarakReport("", "../../evil/id", "content")
	if err != nil {
		t.Fatalf("expected sanitized id to allow CreateTemp, got err: %v", err)
	}
	defer os.Remove(path)
	if strings.Contains(path, "..") {
		t.Errorf("temp file path should not contain '..', got %s", path)
	}
}
