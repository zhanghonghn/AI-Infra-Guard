"""garak-adapter 真实模式集成与单元测试

- :class:`TestRealModeIntegration`：调用 ``python -m garak`` 子进程跑一次端到端
  扫描，使用 garak 内置 ``test.Blank`` 生成器与探针，**完全离线、不需要 LLM Key**。
  在 garak 未安装的环境（GARAK_AVAILABLE=False）会自动跳过。
- :class:`TestReportParser`：用人造的 garak ``.report.jsonl`` 数据验证解析逻辑。
- :class:`TestTargetTypeResolution`：验证 provider → target_type 翻译规则。
- :class:`TestRunnerErrorPaths`：验证错误路径（garak 缺失、空 probe 等）。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

ROOT = str(Path(__file__).resolve().parent.parent)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import runner as runner_mod  # noqa: E402
from runner import GarakRunner, ProbeExample, RunnerError  # noqa: E402


@unittest.skipUnless(runner_mod.GARAK_AVAILABLE, "garak 未安装，跳过真实模式集成测试")
class TestRealModeIntegration(unittest.TestCase):
    """端到端：通过真实 garak CLI 运行 test.Blank 探针。

    test.Blank 探针发送空 prompt，test.Blank 生成器返回固定空输出；
    整个过程不发出真实 LLM 请求、无需任何 Key，约 1 秒内完成。
    适合在 CI 中验证"真集成"链路本身是否健康。
    """

    def test_real_run_with_test_blank(self):
        runner = GarakRunner(
            scan_id="real-it-001",
            provider="test",
            model="Blank",
            probe_groups=["test.Blank"],
            generations=1,
            timeout_sec=180,
        )
        result = runner.run()

        self.assertTrue(result.success)
        self.assertNotEqual(result.garak_version, "mock")
        self.assertNotEqual(result.garak_version, "not_installed")
        self.assertGreaterEqual(len(result.probe_results), 1, "应至少返回一条 probe 结果")

        pr = result.probe_results[0]
        self.assertEqual(pr.probe_id, "test.Blank")
        self.assertNotEqual(pr.detector_name, "")
        self.assertGreaterEqual(pr.total_attempts, 1)
        self.assertGreaterEqual(pr.pass_rate, 0.0)
        self.assertLessEqual(pr.pass_rate, 1.0)

    def test_real_run_to_dict_serializable(self):
        runner = GarakRunner(
            scan_id="real-it-002",
            provider="test",
            model="Blank",
            probe_groups=["test.Blank"],
            generations=1,
            timeout_sec=180,
        )
        result = runner.run()
        # 必须能被 json.dumps：Go 侧才能解析
        json.dumps(result.to_dict())


class TestReportParser(unittest.TestCase):
    """单元测试：用人造的 garak report.jsonl 行验证 _parse_report"""

    @staticmethod
    def _write_report(tmpdir: Path, lines: list) -> Path:
        path = tmpdir / "fake.report.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for line in lines:
                f.write(json.dumps(line) + "\n")
        return path

    def test_parse_eval_and_attempts(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            lines = [
                {"entry_type": "init", "garak_version": "0.14.1"},
                # 已评估的 attempt（会被采样为 example）
                {
                    "entry_type": "attempt", "status": 2, "probe_classname": "dan.Dan_11_0",
                    "prompt": {"turns": [{"role": "user", "content": {"text": "hello dan"}}]},
                    "outputs": [{"text": "model says hi"}],
                    "detector_results": {"dan.DAN": [0.9]},  # >=0.5 → hit → passed=False
                },
                {
                    "entry_type": "attempt", "status": 2, "probe_classname": "dan.Dan_11_0",
                    "prompt": {"turns": [{"role": "user", "content": {"text": "another"}}]},
                    "outputs": [{"text": "ok"}],
                    "detector_results": {"dan.DAN": [0.1]},  # <0.5 → passed=True
                },
                # status != 2 应被忽略
                {
                    "entry_type": "attempt", "status": 1, "probe_classname": "dan.Dan_11_0",
                    "prompt": {"turns": [{"role": "user", "content": {"text": "ignored"}}]},
                    "outputs": [{"text": ""}],
                },
                {
                    "entry_type": "eval", "probe": "dan.Dan_11_0", "detector": "dan.DAN",
                    "passed": 7, "fails": 3, "total_evaluated": 10,
                },
            ]
            report = self._write_report(tmp_path, lines)
            results = GarakRunner._parse_report(report)
        self.assertEqual(len(results), 1)
        r = results[0]
        self.assertEqual(r.probe_id, "dan.Dan_11_0")
        self.assertEqual(r.detector_name, "dan.DAN")
        self.assertEqual(r.total_attempts, 10)
        self.assertEqual(r.failures, 3)
        self.assertAlmostEqual(r.pass_rate, 0.7, places=4)
        # 应采样了两条 attempt
        self.assertEqual(len(r.examples), 2)
        self.assertFalse(r.examples[0].passed)
        self.assertTrue(r.examples[1].passed)
        self.assertEqual(r.examples[0].prompt, "hello dan")
        self.assertEqual(r.examples[0].response, "model says hi")

    def test_parse_picks_worst_detector_per_probe(self):
        """同一 probe 多个 detector 时，应选取 fails 最多者作为代表"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            lines = [
                {
                    "entry_type": "eval", "probe": "x.X", "detector": "d.Mild",
                    "passed": 9, "fails": 1, "total_evaluated": 10,
                },
                {
                    "entry_type": "eval", "probe": "x.X", "detector": "d.Strict",
                    "passed": 4, "fails": 6, "total_evaluated": 10,
                },
            ]
            report = self._write_report(tmp_path, lines)
            results = GarakRunner._parse_report(report)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].detector_name, "d.Strict")
        self.assertEqual(results[0].failures, 6)

    def test_parse_examples_capped_at_5(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            lines = [
                {
                    "entry_type": "attempt", "status": 2, "probe_classname": "p.P",
                    "prompt": {"turns": [{"role": "user", "content": {"text": f"q{i}"}}]},
                    "outputs": [{"text": f"a{i}"}],
                    "detector_results": {"d.D": [0.0]},
                }
                for i in range(10)
            ] + [{
                "entry_type": "eval", "probe": "p.P", "detector": "d.D",
                "passed": 10, "fails": 0, "total_evaluated": 10,
            }]
            report = self._write_report(tmp_path, lines)
            results = GarakRunner._parse_report(report)
        self.assertEqual(len(results[0].examples), 5)

    def test_parse_no_eval_falls_back_to_attempts(self):
        """报告缺失 eval 行时，应基于 attempts 给出占位结果，避免完全丢失信息"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            lines = [
                {
                    "entry_type": "attempt", "status": 2, "probe_classname": "fb.FB",
                    "prompt": {"turns": [{"role": "user", "content": {"text": "x"}}]},
                    "outputs": [{"text": "y"}],
                    "detector_results": {"d.D": [0.9]},
                },
            ]
            report = self._write_report(tmp_path, lines)
            results = GarakRunner._parse_report(report)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].probe_id, "fb.FB")
        self.assertEqual(results[0].failures, 1)

    def test_parse_skips_invalid_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            path = tmp_path / "broken.report.jsonl"
            path.write_text("not-json\n\n{bad json\n", encoding="utf-8")
            results = GarakRunner._parse_report(path)
        self.assertEqual(results, [])


class TestTargetTypeResolution(unittest.TestCase):
    def _runner(self, provider: str) -> GarakRunner:
        return GarakRunner(
            scan_id="t", provider=provider, model="m", probe_groups=["test.Blank"], mock=False,
        )

    def test_known_provider_mapped(self):
        self.assertEqual(self._runner("openai")._resolve_target_type(), "openai")
        self.assertEqual(self._runner("OpenAI")._resolve_target_type(), "openai")
        self.assertEqual(self._runner("hf")._resolve_target_type(), "huggingface")
        self.assertEqual(self._runner("custom")._resolve_target_type(), "rest")

    def test_dotted_provider_passthrough(self):
        """带点号的 provider 视为 garak 原生 target_type，原样透传"""
        self.assertEqual(self._runner("test.Blank")._resolve_target_type(), "test.Blank")
        self.assertEqual(
            self._runner("openai.OpenAIGenerator")._resolve_target_type(),
            "openai.OpenAIGenerator",
        )

    def test_unknown_provider_passthrough(self):
        self.assertEqual(self._runner("brand_new_llm")._resolve_target_type(), "brand_new_llm")

    def test_empty_provider_raises(self):
        with self.assertRaises(RunnerError):
            self._runner("")._resolve_target_type()

    def test_generator_options_with_baseurl(self):
        r = GarakRunner(
            scan_id="t", provider="openai", model="m",
            probe_groups=["x"], base_url="http://localhost:8080/v1",
        )
        opts = r._build_generator_options("openai")
        self.assertEqual(opts, {"openai": {"uri": "http://localhost:8080/v1"}})

    def test_generator_options_dotted(self):
        r = GarakRunner(
            scan_id="t", provider="openai.OpenAIGenerator", model="m",
            probe_groups=["x"], base_url="http://x",
        )
        opts = r._build_generator_options("openai.OpenAIGenerator")
        self.assertEqual(opts, {"openai": {"OpenAIGenerator": {"uri": "http://x"}}})

    def test_generator_options_empty_when_no_baseurl(self):
        r = GarakRunner(
            scan_id="t", provider="openai", model="m", probe_groups=["x"],
        )
        self.assertEqual(r._build_generator_options("openai"), {})


class TestRunnerErrorPaths(unittest.TestCase):
    def test_real_mode_raises_when_garak_missing(self):
        runner = GarakRunner(
            scan_id="t", provider="openai", model="gpt-4o", probe_groups=["dan.Dan_11_0"],
        )
        with unittest.mock.patch.object(runner_mod, "GARAK_AVAILABLE", False):
            with self.assertRaises(RunnerError) as ctx:
                runner.run()
        self.assertIn("Garak 未安装", str(ctx.exception))

    def test_real_mode_raises_on_empty_probes(self):
        runner = GarakRunner(
            scan_id="t", provider="openai", model="gpt-4o", probe_groups=[],
        )
        with unittest.mock.patch.object(runner_mod, "GARAK_AVAILABLE", True):
            with self.assertRaises(RunnerError):
                runner.run()

    def test_subprocess_env_injects_api_key(self):
        runner = GarakRunner(
            scan_id="t", provider="openai", model="m", api_key="sk-secret",
            probe_groups=["x"],
        )
        env = runner._build_subprocess_env()
        self.assertEqual(env.get("OPENAI_API_KEY"), "sk-secret")
        self.assertEqual(env.get("GARAK_API_KEY"), "sk-secret")

    def test_subprocess_env_without_key(self):
        # 临时清空可能从外部继承的 OPENAI_API_KEY，确认我们不会无中生有
        with unittest.mock.patch.dict(os.environ, {}, clear=True):
            runner = GarakRunner(
                scan_id="t", provider="openai", model="m", probe_groups=["x"],
            )
            env = runner._build_subprocess_env()
        self.assertNotIn("OPENAI_API_KEY", env)


if __name__ == "__main__":
    unittest.main()
