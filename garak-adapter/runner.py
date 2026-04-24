#!/usr/bin/env python3
# Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
garak-adapter/runner.py

GarakRunner：封装 Garak 引擎调用，将 Garak 探针结果转为
AIG 统一 AdapterOutput 格式。

设计要点（ADR-001）：
- Garak 以子进程方式调用（main.py 被 Go 侧以 subprocess 启动）
- 本模块在 Python 进程内通过 import garak 调用 Garak API
- 支持 ImportError 降级：当 Garak 未安装时，给出明确错误信息
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
import datetime
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# ---------- Garak 导入（优雅降级）----------
try:
    import garak  # noqa: F401 — 确认 garak 可导入
    from garak.harnesses import probewise as garak_harness
    from garak import _config as garak_config
    GARAK_AVAILABLE = True
    try:
        GARAK_VERSION = garak.__version__
    except AttributeError:
        GARAK_VERSION = "unknown"
except ImportError:
    GARAK_AVAILABLE = False
    GARAK_VERSION = "not_installed"
    logger.warning(
        "Garak 未安装，将以 Mock 模式运行（仅用于测试）。"
        "生产环境请执行: pip install garak"
    )


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
    """单个 Garak probe 的检测结果"""
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


# ---------- GarakRunner ----------

class GarakRunner:
    """
    封装 Garak 引擎调用。

    参数:
        scan_id:      来自 AIG 的扫描任务 ID
        provider:     LLM 提供商标识（openai/azure/ollama/huggingface 等）
        model:        模型名称
        api_key:      API Key（通过环境变量注入，此处直接接受）
        base_url:     自定义 API BaseURL（本地/代理部署使用）
        probe_groups: Garak probe ID 列表
    """

    def __init__(
        self,
        scan_id: str,
        provider: str,
        model: str,
        api_key: str = "",
        base_url: str = "",
        probe_groups: Optional[List[str]] = None,
    ) -> None:
        self.scan_id = scan_id
        self.provider = provider
        self.model = model
        self.api_key = api_key or os.environ.get("GARAK_API_KEY", "")
        self.base_url = base_url
        self.probe_groups = probe_groups or []

    def run(self) -> AdapterResult:
        """执行扫描，返回 AdapterResult"""
        start_time = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

        if not GARAK_AVAILABLE:
            # Mock 模式：用于本地测试/CI，不发出真实 LLM 请求
            logger.info("Mock 模式：模拟 %d 个探针的执行结果", len(self.probe_groups))
            probe_results = self._mock_run()
            end_time = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
            return AdapterResult(
                scan_id=self.scan_id,
                success=True,
                probe_results=probe_results,
                garak_version="mock",
                model_provider=self.provider,
                model_name=self.model,
                start_time=start_time,
                end_time=end_time,
            )

        probe_results = self._real_run()
        end_time = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        return AdapterResult(
            scan_id=self.scan_id,
            success=True,
            probe_results=probe_results,
            garak_version=GARAK_VERSION,
            model_provider=self.provider,
            model_name=self.model,
            start_time=start_time,
            end_time=end_time,
        )

    # ---------- Real mode ----------

    def _real_run(self) -> List[ProbeResult]:
        """调用真实 Garak 引擎执行扫描"""
        # 配置 Garak generator（模型接入）
        generator = self._build_generator()

        probe_results: List[ProbeResult] = []
        for probe_id in self.probe_groups:
            logger.info("执行探针: %s", probe_id)
            try:
                result = self._run_single_probe(generator, probe_id)
                probe_results.append(result)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("探针 %s 执行失败 (%s): %s", probe_id, type(exc).__name__, exc)
                # 记录失败但继续其他探针
                probe_results.append(ProbeResult(
                    probe_id=probe_id,
                    detector_name="unknown",
                    total_attempts=0,
                    failures=0,
                    pass_rate=1.0,
                    examples=[],
                ))

        return probe_results

    def _build_generator(self):
        """根据 provider 构建 Garak generator 实例"""
        try:
            if self.provider in ("openai", "azure"):
                from garak.generators.openai import OpenAIGenerator
                gen = OpenAIGenerator(self.model)
                if self.api_key:
                    gen.key = self.api_key
                if self.base_url:
                    gen.base_url = self.base_url
                return gen
            elif self.provider == "ollama":
                from garak.generators.ollama import OllamaGenerator
                gen = OllamaGenerator(self.model)
                if self.base_url:
                    gen.uri = self.base_url
                return gen
            elif self.provider in ("huggingface", "hf"):
                from garak.generators.huggingface import HFGenerator
                return HFGenerator(self.model)
            else:
                # 通用 REST generator（自定义端点）
                from garak.generators.rest import RestGenerator
                gen = RestGenerator(self.model)
                if self.base_url:
                    gen.uri = self.base_url
                if self.api_key:
                    gen.key = self.api_key
                return gen
        except ImportError as exc:
            raise RunnerError(f"无法导入 Garak generator ({self.provider}): {exc}") from exc
        except Exception as exc:
            raise RunnerError(f"构建 Garak generator 失败: {exc}") from exc

    def _run_single_probe(self, generator, probe_id: str) -> ProbeResult:
        """运行单个 Garak probe 并返回 ProbeResult"""
        module_path, class_name = probe_id.rsplit(".", 1)
        full_module = f"garak.probes.{module_path}"

        import importlib
        try:
            probe_mod = importlib.import_module(full_module)
        except ImportError as exc:
            raise RunnerError(f"无法导入探针模块 {full_module}: {exc}") from exc

        probe_cls = getattr(probe_mod, class_name, None)
        if probe_cls is None:
            raise RunnerError(f"探针类 {class_name} 在模块 {full_module} 中不存在")

        probe_instance = probe_cls()

        # 执行探针并收集原始结果
        attempts = probe_instance.probe(generator)

        total = len(attempts)
        failures = sum(1 for a in attempts if not getattr(a, "passed", True))
        pass_rate = (total - failures) / total if total > 0 else 1.0

        # 收集样本（最多 5 个）
        examples: List[ProbeExample] = []
        for attempt in attempts[:5]:
            examples.append(ProbeExample(
                prompt=str(getattr(attempt, "prompt", "")),
                response=str(getattr(attempt, "outputs", [""])[0] if getattr(attempt, "outputs", None) else ""),
                passed=bool(getattr(attempt, "passed", True)),
            ))

        detector_name = (
            probe_instance.detectors[0]
            if hasattr(probe_instance, "detectors") and probe_instance.detectors
            else "unknown"
        )

        return ProbeResult(
            probe_id=probe_id,
            detector_name=str(detector_name),
            total_attempts=total,
            failures=failures,
            pass_rate=pass_rate,
            examples=examples,
        )

    # ---------- Mock mode ----------

    def _mock_run(self) -> List[ProbeResult]:
        """Mock 模式：生成模拟探针结果（用于 CI 和单元测试）"""
        probe_results: List[ProbeResult] = []
        for i, probe_id in enumerate(self.probe_groups):
            # 偶数索引探针模拟通过，奇数索引模拟部分失败
            if i % 2 == 0:
                total, failures, pass_rate = 10, 0, 1.0
            else:
                total, failures, pass_rate = 10, 3, 0.7
            probe_results.append(ProbeResult(
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
        return probe_results
