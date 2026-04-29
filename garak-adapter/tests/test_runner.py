"""
garak-adapter 单元测试

覆盖：
- AdapterResult：序列化、字段完整性
- ProbeResult：字段完整性
- GarakRunner（Mock 模式）：运行逻辑、结果验证
- 契约测试（Contract Tests）：使用 fixtures/sample_output.json 验证输出格式契约
"""

import json
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

# 确保 garak-adapter 目录在 sys.path 中
ROOT = str(Path(__file__).resolve().parent.parent)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from runner import AdapterResult, GarakRunner, ProbeResult, ProbeExample, RunnerError  # noqa: E402

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestProbeResult(unittest.TestCase):
    """ProbeResult dataclass 基本字段测试"""

    def _make_probe(self, **kwargs):
        defaults = dict(
            probe_id="dan.Dan_11_0",
            detector_name="always.Fail",
            total_attempts=10,
            failures=3,
            pass_rate=0.7,
            examples=[ProbeExample(prompt="p", response="r", passed=False)],
        )
        defaults.update(kwargs)
        return ProbeResult(**defaults)

    def test_to_dict_all_fields(self):
        p = self._make_probe()
        d = p.to_dict()
        for key in ("probe_id", "detector_name", "total_attempts", "failures", "pass_rate", "examples"):
            self.assertIn(key, d, f"字段 {key} 应存在于 to_dict() 输出")

    def test_to_dict_empty_examples(self):
        p = self._make_probe(examples=[])
        d = p.to_dict()
        self.assertEqual(d["examples"], [])


class TestAdapterResult(unittest.TestCase):
    """AdapterResult 序列化测试"""

    def _make_result(self):
        probe = ProbeResult(
            probe_id="dan.Dan_11_0",
            detector_name="always.Fail",
            total_attempts=5,
            failures=2,
            pass_rate=0.6,
            examples=[],
        )
        return AdapterResult(
            scan_id="test-001",
            success=True,
            probe_results=[probe],
            garak_version="0.9.0.17",
            model_provider="openai",
            model_name="gpt-4o",
            start_time="2026-01-01T00:00:00Z",
            end_time="2026-01-01T00:15:00Z",
        )

    def test_to_dict_top_level_keys(self):
        d = self._make_result().to_dict()
        for key in ("scan_id", "success", "probe_results", "metadata",
                    "adapter_version", "garak_version"):
            self.assertIn(key, d)

    def test_to_dict_serializable(self):
        """输出应该可以被 json.dumps 序列化（确保 Go 侧可以解析）"""
        d = self._make_result().to_dict()
        try:
            json.dumps(d)
        except (TypeError, ValueError) as exc:
            self.fail(f"to_dict() 输出不可序列化: {exc}")

    def test_to_dict_metadata_keys(self):
        d = self._make_result().to_dict()
        for key in ("model_provider", "model_name", "start_time", "end_time"):
            self.assertIn(key, d["metadata"], f"metadata 缺少字段: {key}")


class TestGarakRunnerMockMode(unittest.TestCase):
    """GarakRunner Mock 模式测试（无需真实 Garak 或 LLM）"""

    def _make_runner(self, probe_groups=None):
        if probe_groups is None:
            probe_groups = ["dan.Dan_11_0", "lmrc.Deadnames"]
        return GarakRunner(
            scan_id="mock-scan-001",
            provider="openai",
            model="gpt-4o",
            api_key="sk-test",
            probe_groups=probe_groups,
            mock=True,
        )

    def test_mock_run_returns_adapter_result(self):
        runner = self._make_runner()
        result = runner.run()
        self.assertIsInstance(result, AdapterResult)

    def test_mock_run_has_correct_probe_count(self):
        probes = ["dan.Dan_11_0", "lmrc.Deadnames"]
        runner = self._make_runner(probe_groups=probes)
        result = runner.run()
        self.assertEqual(len(result.probe_results), len(probes))

    def test_mock_run_probe_ids_match(self):
        probes = ["dan.Dan_11_0", "lmrc.Deadnames"]
        runner = self._make_runner(probe_groups=probes)
        result = runner.run()
        result_ids = {p.probe_id for p in result.probe_results}
        self.assertEqual(result_ids, set(probes))

    def test_mock_run_pass_rate_range(self):
        """Pass rate 必须在 [0.0, 1.0] 范围内"""
        runner = self._make_runner()
        result = runner.run()
        for probe in result.probe_results:
            self.assertGreaterEqual(probe.pass_rate, 0.0)
            self.assertLessEqual(probe.pass_rate, 1.0)

    def test_mock_run_empty_probes(self):
        """空探针列表时应返回成功但结果为空"""
        runner = self._make_runner(probe_groups=[])
        result = runner.run()
        self.assertEqual(len(result.probe_results), 0)

    def test_mock_run_to_dict_valid(self):
        """to_dict 输出应可序列化且符合契约键名"""
        runner = self._make_runner()
        result = runner.run()
        d = result.to_dict()
        json.dumps(d)  # must not raise
        for key in ("scan_id", "success", "probe_results", "metadata", "adapter_version"):
            self.assertIn(key, d)

    def test_mock_via_env_var(self):
        """通过 GARAK_MOCK 环境变量也应能开启 Mock 模式"""
        with unittest.mock.patch.dict(os.environ, {"GARAK_MOCK": "1"}):
            runner = GarakRunner(
                scan_id="env-mock-001",
                provider="openai",
                model="gpt-4o",
                probe_groups=["dan.Dan_11_0"],
            )
            result = runner.run()
        self.assertEqual(result.garak_version, "mock")

    def test_build_generator_options_openai_default_class(self):
        """openai provider 在未显式类名时应注入 OpenAIGenerator 层级"""
        runner = GarakRunner(
            scan_id="opt-001",
            provider="openai",
            model="gpt-4o",
            base_url="https://api.example.com/v1",
            probe_groups=["dan.Dan_11_0"],
            mock=True,
        )
        opts = runner._build_generator_options("openai")
        self.assertEqual(
            opts,
            {"openai": {"OpenAIGenerator": {"uri": "https://api.example.com/v1"}}},
        )

    def test_build_subprocess_env_sets_openai_base_url(self):
        """提供 base_url 时应同步注入 OPENAI_BASE_URL 环境变量"""
        runner = GarakRunner(
            scan_id="env-001",
            provider="openai",
            model="gpt-4o",
            api_key="sk-test",
            base_url="https://api.example.com/v1",
            probe_groups=["dan.Dan_11_0"],
            mock=True,
        )
        env = runner._build_subprocess_env()
        self.assertEqual(env.get("OPENAI_BASE_URL"), "https://api.example.com/v1")

    def test_normalize_probe_groups_prefers_available_new_names(self):
        runner = self._make_runner(probe_groups=["promptinject.HijackHateHumanized", "lmrc.Deadnames"])
        with unittest.mock.patch.object(
            GarakRunner,
            "_discover_available_probes",
            return_value={"promptinject.HijackHateHumans", "lmrc.Deadnaming"},
        ):
            probes = runner._normalize_probe_groups(runner.probe_groups)
        self.assertEqual(probes, ["promptinject.HijackHateHumans", "lmrc.Deadnaming"])

    def test_normalize_probe_groups_fallback_without_plugin_cache(self):
        runner = self._make_runner(probe_groups=["promptinject.HijackHateHumanized", "lmrc.Deadnames"])
        with unittest.mock.patch.object(GarakRunner, "_discover_available_probes", return_value=set()):
            probes = runner._normalize_probe_groups(runner.probe_groups)
        self.assertEqual(probes, ["promptinject.HijackHateHumans", "lmrc.Deadnaming"])

    def test_normalize_probe_groups_deduplicates_after_alias(self):
        runner = self._make_runner(
            probe_groups=["lmrc.Deadnames", "lmrc.Deadnaming", "promptinject.HijackHateHumans"]
        )
        with unittest.mock.patch.object(
            GarakRunner,
            "_discover_available_probes",
            return_value={"lmrc.Deadnaming", "promptinject.HijackHateHumans"},
        ):
            probes = runner._normalize_probe_groups(runner.probe_groups)
        self.assertEqual(probes, ["lmrc.Deadnaming", "promptinject.HijackHateHumans"])


class TestContractWithFixture(unittest.TestCase):
    """
    契约测试（Contract Tests）

    使用 fixtures/sample_output.json 验证 Go 侧期望的输出 Schema 与
    Python 侧实际生成的数据格式保持一致。
    """

    @classmethod
    def setUpClass(cls):
        fixture_path = FIXTURES_DIR / "sample_output.json"
        with open(fixture_path, encoding="utf-8") as f:
            cls.fixture = json.load(f)

    def test_top_level_required_keys(self):
        for key in ("scan_id", "success", "probe_results", "metadata",
                    "adapter_version", "garak_version"):
            self.assertIn(key, self.fixture, f"契约字段缺失: {key}")

    def test_probe_results_is_list(self):
        self.assertIsInstance(self.fixture["probe_results"], list)

    def test_each_probe_result_has_required_fields(self):
        for probe in self.fixture["probe_results"]:
            for field in ("probe_id", "detector_name", "total_attempts",
                          "failures", "pass_rate", "examples"):
                self.assertIn(field, probe, f"probe_result 缺少字段: {field}")

    def test_examples_have_required_fields(self):
        for probe in self.fixture["probe_results"]:
            for ex in probe["examples"]:
                for field in ("prompt", "response", "passed"):
                    self.assertIn(field, ex, f"example 缺少字段: {field}")

    def test_metadata_has_required_fields(self):
        meta = self.fixture["metadata"]
        for field in ("model_provider", "model_name", "start_time", "end_time"):
            self.assertIn(field, meta, f"metadata 缺少字段: {field}")

    def test_pass_rate_in_valid_range(self):
        for probe in self.fixture["probe_results"]:
            rate = probe["pass_rate"]
            self.assertGreaterEqual(rate, 0.0)
            self.assertLessEqual(rate, 1.0)

    def test_total_attempts_and_failures_consistent(self):
        for probe in self.fixture["probe_results"]:
            self.assertGreaterEqual(probe["total_attempts"], probe["failures"])


class TestReportParsingCompatibility(unittest.TestCase):
    def test_parse_report_fallback_to_total_processed(self):
        lines = [
            {
                "entry_type": "attempt",
                "status": 2,
                "probe_classname": "dan.Dan_11_0",
                "prompt": {"turns": [{"content": {"text": "p"}}]},
                "outputs": [{"text": "r"}],
                "detector_results": {"det": [0.1]},
            },
            {
                "entry_type": "eval",
                "probe": "dan.Dan_11_0",
                "detector": "dan.DAN",
                "passed": 1,
                "fails": 0,
                "total_processed": 1,
            },
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
            path = f.name
            for rec in lines:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))

        results = GarakRunner._parse_report(Path(path))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].total_attempts, 1)

    def test_real_run_zero_attempts_raises_runner_error(self):
        runner = GarakRunner(
            scan_id="zero-attempts",
            provider="openai",
            model="gpt-4o",
            probe_groups=["dan.Dan_11_0"],
        )

        fake_proc = unittest.mock.Mock()
        fake_proc.stdout = ""
        fake_proc.stderr = "upstream auth failed"
        fake_proc.returncode = 0

        class _DummyTmpDir:
            def __init__(self, p):
                self._p = p
            def __enter__(self):
                return self._p
            def __exit__(self, exc_type, exc_val, exc_tb):
                return False

        with unittest.mock.patch("runner.tempfile.TemporaryDirectory", return_value=_DummyTmpDir("/tmp")), \
            unittest.mock.patch("runner.subprocess.run", return_value=fake_proc), \
            unittest.mock.patch.object(GarakRunner, "_locate_report", return_value=Path("/tmp/fake.report.jsonl")), \
            unittest.mock.patch.object(GarakRunner, "_parse_report", return_value=[
                ProbeResult("dan.Dan_11_0", "det", 0, 0, 1.0, []),
            ]):
            with self.assertRaises(RunnerError) as ctx:
                runner._real_run()
        self.assertIn("total_attempts=0", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
