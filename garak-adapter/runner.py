#!/usr/bin/env python3
# Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Requirement: Any integration or derivative work must explicitly attribute
# Tencent Zhuque Lab (https://github.com/Tencent/AI-Infra-Guard) in its
# documentation or user interface, as detailed in the NOTICE file.

"""garak-adapter/runner.py — 真实 Garak 集成运行器

本模块通过 Garak 官方 CLI（``python -m garak``）以子进程方式驱动 Garak
执行探针扫描，并解析其输出的 ``*.report.jsonl`` 报告，转换为 AIG 统一的
``AdapterOutput`` schema 返回给 Go 侧。

设计要点（与 ADR-001 对齐）::

    AIG Agent (Go)
        └── subprocess: python garak-adapter/main.py
                          └── subprocess: python -m garak --target_type ...
                                            └── garak_runs/<scan_id>.report.jsonl
            ↑ runner.py 解析该 JSONL 并以统一 schema 输出到 stdout

为什么使用 CLI 而非直接 import garak API：
    1. Garak 的内部 Python API 在不同小版本之间会变化（例如 ``probe.probe()``
       的签名和返回结构在 0.10/0.13/0.14 之间均不同），CLI + JSONL 报告才是
       Garak 官方稳定的"对外契约"。
    2. CLI 自带健全的进程隔离与超时管控，避免 garak 内部异常污染 adapter。
    3. JSONL 报告中的 ``entry_type=eval`` 行已经聚合了 ``passed/fails`` 等
       关键字段，正是 AIG ``ProbeResult`` 所需的内容。

Mock 模式说明：
    Mock 模式仅用于无 garak 环境的 CI 烟测和契约测试，**默认禁用**。
    可通过环境变量 ``GARAK_MOCK=1`` 或构造函数参数 ``mock=True`` 显式开启。
    当真实模式被请求但 Garak 未安装时，本模块将抛出 :class:`RunnerError`，
    让上游明确感知"集成未就绪"，而非静默回退到 Mock 产生误导性结果。
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional

logger = logging.getLogger(__name__)

# ---------- Garak 可用性探测（不再做静默回退） ----------
try:
    import garak  # noqa: F401 — 仅探测可用性
    GARAK_AVAILABLE = True
    try:
        GARAK_VERSION = garak.__version__
    except AttributeError:
        GARAK_VERSION = "unknown"
except ImportError:
    GARAK_AVAILABLE = False
    GARAK_VERSION = "not_installed"


# ---------- 数据模型 ----------

@dataclass
class ProbeExample:
    """单次探测的请求/响应样本"""
    prompt: str
    response: str
    passed: bool

    def to_dict(self) -> dict:
        return {"prompt": self.prompt, "response": self.response, "passed": self.passed}


@dataclass
class ProbeResult:
    """单个 Garak probe 的检测结果（已经过 detector 聚合）"""
    probe_id: str
    detector_name: str
    total_attempts: int
    failures: int
    pass_rate: float
    examples: List[ProbeExample] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "probe_id": self.probe_id,
            "detector_name": self.detector_name,
            "total_attempts": self.total_attempts,
            "failures": self.failures,
            "pass_rate": self.pass_rate,
            "examples": [e.to_dict() for e in self.examples],
        }


@dataclass
class AdapterResult:
    """GarakRunner 返回给 main.py 的完整结果"""
    scan_id: str
    success: bool
    probe_results: List[ProbeResult]
    garak_version: str
    model_provider: str
    model_name: str
    start_time: str
    end_time: str
    error: Optional[str] = None

    def to_dict(self, adapter_version: str = "1.0.0") -> dict:
        return {
            "adapter_version": adapter_version,
            "garak_version": self.garak_version,
            "scan_id": self.scan_id,
            "success": self.success,
            "probe_results": [pr.to_dict() for pr in self.probe_results],
            "metadata": {
                "start_time": self.start_time,
                "end_time": self.end_time,
                "model_provider": self.model_provider,
                "model_name": self.model_name,
            },
        }


class RunnerError(Exception):
    """Garak 运行时错误"""


# ---------- Provider → Garak target_type 映射 ----------

# Garak 提供商映射：将 AIG 侧的标识翻译为 Garak CLI ``--target_type`` 参数。
# 未列出的 provider 视为透传（允许用户直接指定 ``module.Class``，例如
# ``test.Blank`` 或 ``rest.RestGenerator``）。
_PROVIDER_MAP = {
    "openai": "openai",
    "azure": "azure",
    "ollama": "ollama",
    "huggingface": "huggingface",
    "hf": "huggingface",
    "rest": "rest",
    "custom": "rest",
    "test": "test",
}

_DEFAULT_GENERATOR_CLASS = {
    "openai": "OpenAIGenerator",
    "azure": "AzureOpenAIGenerator",
    "ollama": "OllamaGenerator",
}

_PROBE_ALIAS_CANDIDATES = {
    "promptinject.HijackHateHumanized": ["promptinject.HijackHateHumans", "promptinject.HijackHateHumanized"],
    "promptinject.HijackHateHumans": ["promptinject.HijackHateHumans", "promptinject.HijackHateHumanized"],
    "promptinject.HijackKillHumanized": ["promptinject.HijackKillHumans", "promptinject.HijackKillHumanized"],
    "promptinject.HijackKillHumans": ["promptinject.HijackKillHumans", "promptinject.HijackKillHumanized"],
    "lmrc.Deadnames": ["lmrc.Deadnaming", "lmrc.Deadnames"],
    "lmrc.Deadnaming": ["lmrc.Deadnaming", "lmrc.Deadnames"],
}


def _utc_iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


# ---------- GarakRunner ----------

class GarakRunner:
    """封装 Garak 引擎调用。

    参数:
        scan_id:      扫描任务 ID（同时作为 Garak ``--report_prefix``）
        provider:     LLM 提供商标识；将翻译为 Garak ``--target_type``
        model:        模型名称；对应 Garak ``--target_name``
        api_key:      API Key（也会以 ``GARAK_API_KEY``/``OPENAI_API_KEY`` 等
                      环境变量形式注入子进程）
        base_url:     自定义 API BaseURL（用于本地/代理部署）
        probe_groups: Garak probe ID 列表
        generations:  每个 prompt 的生成次数（默认 1）
        timeout_sec:  单次 garak 子进程超时（默认 1200s = 20min）
        mock:         显式开启 mock 模式（默认 False）。也可通过环境变量
                      ``GARAK_MOCK=1`` 开启。
        python_bin:   覆盖运行 garak 的 Python 解释器路径（默认 sys.executable）
    """

    def __init__(
        self,
        scan_id: str,
        provider: str,
        model: str,
        api_key: str = "",
        base_url: str = "",
        probe_groups: Optional[List[str]] = None,
        generations: int = 1,
        timeout_sec: int = 1200,
        mock: bool = False,
        python_bin: Optional[str] = None,
    ) -> None:
        self.scan_id = scan_id
        self.provider = (provider or "").strip()
        self.model = model
        self.api_key = api_key or os.environ.get("GARAK_API_KEY", "")
        self.base_url = base_url
        self.probe_groups = list(probe_groups or [])
        self.generations = max(1, int(generations))
        self.timeout_sec = max(1, int(timeout_sec))
        self.mock = bool(mock) or os.environ.get("GARAK_MOCK", "").lower() in ("1", "true", "yes")
        self.python_bin = python_bin or sys.executable

    # ---------- 主入口 ----------

    def run(self) -> AdapterResult:
        """执行扫描，返回 AdapterResult。"""
        start_time = _utc_iso_now()

        if self.mock:
            logger.info("Mock 模式（显式开启）：模拟 %d 个探针", len(self.probe_groups))
            probe_results = self._mock_run()
            return AdapterResult(
                scan_id=self.scan_id,
                success=True,
                probe_results=probe_results,
                garak_version="mock",
                model_provider=self.provider,
                model_name=self.model,
                start_time=start_time,
                end_time=_utc_iso_now(),
            )

        if not GARAK_AVAILABLE:
            raise RunnerError(
                "Garak 未安装，无法执行真实扫描。请执行 `pip install garak`，"
                "或显式开启 Mock 模式（环境变量 GARAK_MOCK=1）。"
            )

        if not self.probe_groups:
            raise RunnerError("probe_groups 为空，至少需要指定一个 Garak 探针 ID")

        probe_results = self._real_run()
        return AdapterResult(
            scan_id=self.scan_id,
            success=True,
            probe_results=probe_results,
            garak_version=GARAK_VERSION,
            model_provider=self.provider,
            model_name=self.model,
            start_time=start_time,
            end_time=_utc_iso_now(),
        )

    # ---------- 真实模式（CLI 子进程） ----------

    def _real_run(self) -> List[ProbeResult]:
        """通过 ``python -m garak`` 子进程执行扫描，并解析 JSONL 报告。"""
        target_type = self._resolve_target_type()
        probes = self._normalize_probe_groups(self.probe_groups)

        # 在隔离的临时目录中运行 garak，避免污染用户 ~/.local/share/garak
        with tempfile.TemporaryDirectory(prefix=f"garak-{self.scan_id}-") as workdir:
            # 安全的 report_prefix（绝对路径），保证后续能定位到报告文件
            safe_prefix = "".join(c if c.isalnum() or c in "-_." else "_" for c in self.scan_id) or "scan"
            report_prefix = str(Path(workdir) / safe_prefix)

            argv = [
                self.python_bin, "-m", "garak",
                "--target_type", target_type,
                "--probes", ",".join(probes),
                "--report_prefix", report_prefix,
                "--generations", str(self.generations),
                "--narrow_output",
            ]
            # ``--target_name`` 在使用 test.* 等无需名称的生成器时可以省略
            if self.model:
                argv.extend(["--target_name", self.model])

            # 通用 generator 选项（base_url 等）通过 --generator_options JSON 注入
            gen_opts = self._build_generator_options(target_type)
            if gen_opts:
                argv.extend(["--generator_options", json.dumps(gen_opts)])

            env = self._build_subprocess_env()
            logger.info("运行 Garak: %s", " ".join(_redact_argv(argv)))

            try:
                proc = subprocess.run(  # noqa: S603 — argv is internally constructed
                    argv,
                    cwd=workdir,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_sec,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise RunnerError(
                    f"Garak 子进程超时（>{self.timeout_sec}s）"
                ) from exc
            except FileNotFoundError as exc:
                raise RunnerError(f"无法启动 Python 解释器 {self.python_bin}: {exc}") from exc

            if proc.stdout:
                logger.debug("[garak stdout]\n%s", proc.stdout)
            if proc.stderr:
                logger.debug("[garak stderr]\n%s", proc.stderr)

            report_path = self._locate_report(report_prefix, workdir)
            if report_path is None:
                tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-20:]
                raise RunnerError(
                    "Garak 子进程未生成报告文件 (rc={rc})；最后输出: {tail}".format(
                        rc=proc.returncode, tail=" | ".join(tail)
                    )
                )

            results = self._parse_report(report_path)
            total_attempts = sum(max(0, int(r.total_attempts)) for r in results)
            if total_attempts == 0:
                tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-20:]
                raise RunnerError(
                    "Garak 扫描未产生有效评估数据（total_attempts=0）；"
                    "请检查模型凭证/连通性/限流配置。最后输出: {tail}".format(
                        tail=" | ".join(tail)
                    )
                )

            return results

    # ---------- 辅助方法 ----------

    def _resolve_target_type(self) -> str:
        """将 AIG provider 字段翻译为 Garak --target_type。

        若用户传入的字符串包含 ``.``（例如 ``test.Blank`` 或
        ``openai.OpenAIGenerator``），则视为已是合法 Garak target_type，原样透传。
        """
        if not self.provider:
            raise RunnerError("model_provider 不可为空")
        if "." in self.provider:
            return self.provider
        mapped = _PROVIDER_MAP.get(self.provider.lower())
        if not mapped:
            # 未识别的 provider 也允许透传，让 Garak 自己报错给出明确提示
            logger.warning("未知 provider '%s'，原样传给 Garak", self.provider)
            return self.provider
        return mapped

    def _build_generator_options(self, target_type: str) -> dict:
        """为 ``--generator_options`` 构造嵌套字典。

        Garak 的 generator_options 形如::

            {"openai": {"OpenAIGenerator": {"uri": "...", "api_key": "..."}}}

        本方法只在 ``base_url`` 非空时注入 ``uri``；api_key 通过环境变量传递，
        避免出现在命令行/日志中。
        """
        if not self.base_url:
            return {}
        # target_type 可能是 "openai" 或 "openai.OpenAIGenerator"
        parts = target_type.split(".", 1)
        module = parts[0]
        cls = parts[1] if len(parts) > 1 else None
        inner = {"uri": self.base_url}
        if not cls:
            cls = _DEFAULT_GENERATOR_CLASS.get(module)
        if cls:
            return {module: {cls: inner}}
        return {module: inner}

    def _build_subprocess_env(self) -> dict:
        env = os.environ.copy()
        if self.base_url:
            env.setdefault("OPENAI_BASE_URL", self.base_url)
        if self.api_key:
            # 同时设置多种 provider 常用的 key 名，避免 generator 取不到
            env.setdefault("OPENAI_API_KEY", self.api_key)
            env.setdefault("AZURE_API_KEY", self.api_key)
            env["GARAK_API_KEY"] = self.api_key
        # 关闭 garak 的 telemetry / 交互模式（如果未来支持）
        env.setdefault("GARAK_NO_TELEMETRY", "1")
        return env

    def _normalize_probe_groups(self, probe_groups: List[str]) -> List[str]:
        """按当前 Garak 安装版本可用探针，规范化输入探针列表。"""
        available = self._discover_available_probes()
        normalized: List[str] = []
        seen = set()

        for probe in probe_groups:
            p = (probe or "").strip()
            if not p:
                continue
            chosen = self._choose_probe_alias(p, available)
            if chosen != p:
                logger.warning("探针名版本兼容映射: %s -> %s", p, chosen)
            if chosen in seen:
                continue
            seen.add(chosen)
            normalized.append(chosen)

        return normalized

    def _choose_probe_alias(self, probe: str, available: set[str]) -> str:
        candidates = _PROBE_ALIAS_CANDIDATES.get(probe)
        if not candidates:
            return probe
        if available:
            for candidate in candidates:
                if candidate in available:
                    return candidate
        return candidates[0]

    @staticmethod
    def _discover_available_probes() -> set[str]:
        """从 Garak plugin_cache 中解析当前安装版本支持的 probes。"""
        try:
            import garak  # noqa: F401
        except ImportError:
            return set()

        cache_path = Path(garak.__file__).resolve().parent / "resources" / "plugin_cache.json"
        if not cache_path.is_file():
            return set()

        try:
            with cache_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError):
            return set()

        if not isinstance(payload, dict):
            return set()

        probes = set()
        for key in payload.keys():
            if not isinstance(key, str):
                continue
            if key.startswith("probes."):
                probes.add(key[len("probes."):])
        return probes

    @staticmethod
    def _locate_report(report_prefix: str, workdir: str) -> Optional[Path]:
        """定位 Garak 生成的 ``.report.jsonl`` 文件。

        Garak 默认会把报告写入 ``$XDG_DATA_HOME/garak/garak_runs/<prefix>.report.jsonl``，
        但当传入绝对 ``--report_prefix`` 时也可能直接写到该路径。这里两个位置都尝试。
        """
        candidates: List[Path] = [
            Path(f"{report_prefix}.report.jsonl"),
            Path(workdir) / "garak_runs" / f"{Path(report_prefix).name}.report.jsonl",
        ]
        # XDG fallback
        xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        candidates.append(Path(xdg) / "garak" / "garak_runs" / f"{Path(report_prefix).name}.report.jsonl")
        for c in candidates:
            if c.is_file():
                return c
        return None

    @staticmethod
    def _parse_report(report_path: Path) -> List[ProbeResult]:
        """解析 Garak ``.report.jsonl`` 报告。

        Garak 报告每行一条 JSON 记录，关键 entry_type::

            * ``attempt``：单次 prompt/response 记录（status=2 表示已评估）
            * ``eval``：聚合后的探针×detector 评估结果（含 passed/total_evaluated）

        本方法以 (probe_classname, detector) 为键聚合，并从 attempt 行采样
        最多 5 条 prompt/response 作为 examples。
        """
        # examples_by_probe[probe_classname] -> list of ProbeExample
        examples_by_probe: dict[str, List[ProbeExample]] = {}
        # eval_records[(probe, detector)] -> dict
        eval_records: dict[tuple, dict] = {}

        with report_path.open("r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    rec = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                etype = rec.get("entry_type")
                if etype == "attempt" and rec.get("status") == 2:
                    probe = rec.get("probe_classname", "")
                    if not probe:
                        continue
                    bucket = examples_by_probe.setdefault(probe, [])
                    if len(bucket) >= 5:
                        continue
                    prompt_text = _extract_prompt_text(rec)
                    response_text = _extract_response_text(rec)
                    detector_results = rec.get("detector_results") or {}
                    # passed = 所有 detector 评分均 < 0.5（沿用 garak 默认 hit 阈值）
                    passed = True
                    for scores in detector_results.values():
                        if isinstance(scores, list) and any(
                            isinstance(s, (int, float)) and s >= 0.5 for s in scores
                        ):
                            passed = False
                            break
                    bucket.append(ProbeExample(
                        prompt=prompt_text,
                        response=response_text,
                        passed=passed,
                    ))
                elif etype == "eval":
                    probe = rec.get("probe", "")
                    detector = rec.get("detector", "")
                    if not probe or not detector:
                        continue
                    eval_records[(probe, detector)] = rec

        # 把 (probe, detector) 列表转为 ProbeResult 列表
        results: List[ProbeResult] = []
        if not eval_records:
            # 没有 eval 行 → 至少根据 attempts 输出一份占位结果，让上游不至于完全丢失信息
            for probe, examples in examples_by_probe.items():
                total = len(examples)
                fails = sum(1 for e in examples if not e.passed)
                pass_rate = (total - fails) / total if total > 0 else 1.0
                results.append(ProbeResult(
                    probe_id=probe,
                    detector_name="unknown",
                    total_attempts=total,
                    failures=fails,
                    pass_rate=pass_rate,
                    examples=examples,
                ))
            return results

        # 按 probe 聚合多个 detector：选 fails 最多的 detector 作为代表
        best_per_probe: dict[str, dict] = {}
        for (probe, detector), rec in eval_records.items():
            existing = best_per_probe.get(probe)
            if existing is None or rec.get("fails", 0) > existing.get("fails", 0):
                # 拷贝并附加 detector 名
                merged = dict(rec)
                merged["__detector"] = detector
                best_per_probe[probe] = merged

        for probe, rec in best_per_probe.items():
            total_eval = _to_int(rec.get("total_evaluated"))
            if total_eval <= 0:
                total_eval = _to_int(rec.get("total_processed"))
            passed = int(rec.get("passed") or 0)
            fails = int(rec.get("fails") or 0)
            # garak ``passed`` 字段是 "通过的次数"，pass_rate 直接由它计算
            pass_rate = (passed / total_eval) if total_eval > 0 else 1.0
            results.append(ProbeResult(
                probe_id=probe,
                detector_name=rec.get("__detector", "unknown"),
                total_attempts=total_eval,
                failures=fails,
                pass_rate=max(0.0, min(1.0, pass_rate)),
                examples=examples_by_probe.get(probe, []),
            ))
        return results

    # ---------- Mock 模式 ----------

    def _mock_run(self) -> List[ProbeResult]:
        """Mock 模式：用于无 garak 环境的契约测试与 CI 烟测。"""
        results: List[ProbeResult] = []
        for i, probe_id in enumerate(self.probe_groups):
            if i % 2 == 0:
                total, failures, pass_rate = 10, 0, 1.0
            else:
                total, failures, pass_rate = 10, 3, 0.7
            results.append(ProbeResult(
                probe_id=probe_id,
                detector_name="mock.MockDetector",
                total_attempts=total,
                failures=failures,
                pass_rate=pass_rate,
                examples=[
                    ProbeExample(
                        prompt=f"[mock] test prompt for {probe_id}",
                        response="[mock] model response",
                        passed=(pass_rate == 1.0),
                    )
                ],
            ))
        return results


# ---------- 报告解析辅助 ----------

def _extract_prompt_text(attempt_rec: dict) -> str:
    prompt = attempt_rec.get("prompt") or {}
    turns = prompt.get("turns") if isinstance(prompt, dict) else None
    if isinstance(turns, list) and turns:
        first = turns[0]
        content = first.get("content") if isinstance(first, dict) else None
        if isinstance(content, dict):
            text = content.get("text")
            if isinstance(text, str):
                return text
    if isinstance(prompt, str):
        return prompt
    return ""


def _extract_response_text(attempt_rec: dict) -> str:
    outputs = attempt_rec.get("outputs") or []
    if isinstance(outputs, list) and outputs:
        first = outputs[0]
        if isinstance(first, dict):
            text = first.get("text")
            if isinstance(text, str):
                return text
        if isinstance(first, str):
            return first
    return ""


def _to_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _redact_argv(argv: Iterable[str]) -> List[str]:
    """日志输出 argv 时屏蔽明显的敏感参数（当前实现里我们不把 key 放在
    命令行，但保留此函数作为防御性兜底）。"""
    redacted: List[str] = []
    skip_next = False
    for a in argv:
        if skip_next:
            redacted.append("***")
            skip_next = False
            continue
        if a in ("--api-key", "--api_key", "--key"):
            redacted.append(a)
            skip_next = True
            continue
        redacted.append(a)
    return redacted


# 保持 shutil 引用以便测试 monkeypatch 子进程查找
_ = shutil
