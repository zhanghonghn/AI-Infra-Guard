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

"""
garak-adapter/main.py

CLI 入口：接收 JSON 参数 → 运行 Garak → 输出标准化 JSON → 退出

与 AIG Agent 的契约（A.3）：
- 入参：CLI 参数，通过 --scan-id, --model-provider 等传入
- 凭证：通过环境变量 GARAK_API_KEY 注入，不在命令行出现
- 出参：最后一行 stdout 输出标准 JSON（符合 AdapterOutput schema）
- 退出码：0=成功, 1=部分失败（存在 probe 失败但整体完成）, 2=完全失败

日志（进度）通过 stderr 或 non-JSON stdout 行输出；
最终 JSON 结果始终作为最后一行 stdout 输出，以 '{' 开头。
"""

import argparse
import json
import sys
import os
import logging

from runner import GarakRunner, RunnerError

# 设置日志格式（输出到 stderr，不干扰 stdout 的 JSON 输出）
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [garak-adapter] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

ADAPTER_VERSION = "1.0.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AIG Garak Adapter — Garak LLM 安全扫描适配器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--scan-id", required=True, help="扫描任务 ID")
    parser.add_argument("--model-provider", required=True, help="LLM 提供商（openai/azure/ollama/custom）")
    parser.add_argument("--model-name", required=True, help="LLM 模型名称")
    parser.add_argument(
        "--probe-groups",
        required=True,
        help="逗号分隔的 Garak probe ID 列表，如 dan.Dan_11_0,lmrc.Deadnames",
    )
    parser.add_argument("--base-url", default="", help="自定义 LLM API BaseURL（本地部署时使用）")
    parser.add_argument(
        "--generations", type=int, default=1,
        help="每个 prompt 的生成次数（透传给 garak --generations）",
    )
    parser.add_argument(
        "--timeout-sec", type=int, default=1200,
        help="garak 子进程超时时间（秒），默认 1200s",
    )
    parser.add_argument(
        "--mock", action="store_true",
        help="使用 Mock 模式（不调用真实 garak / LLM），仅用于 CI 烟测",
    )
    parser.add_argument(
        "--output-format",
        choices=["json"],
        default="json",
        help="输出格式（当前仅支持 json）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    api_key = os.environ.get("GARAK_API_KEY", "")
    probe_groups = [p.strip() for p in args.probe_groups.split(",") if p.strip()]

    logger.info(
        "启动 Garak 扫描: scan_id=%s provider=%s model=%s probes=%d",
        args.scan_id,
        args.model_provider,
        args.model_name,
        len(probe_groups),
    )

    runner = GarakRunner(
        scan_id=args.scan_id,
        provider=args.model_provider,
        model=args.model_name,
        api_key=api_key,
        base_url=args.base_url,
        probe_groups=probe_groups,
        generations=args.generations,
        timeout_sec=args.timeout_sec,
        mock=args.mock,
    )

    try:
        result = runner.run()
    except RunnerError as exc:
        logger.error("Garak 运行失败: %s", exc)
        error_output = {
            "adapter_version": ADAPTER_VERSION,
            "garak_version": "unknown",
            "scan_id": args.scan_id,
            "success": False,
            "probe_results": [],
            "metadata": {
                "model_provider": args.model_provider,
                "model_name": args.model_name,
                "error": str(exc),
            },
        }
        # 最终 JSON 输出（即使失败也输出，Go 侧可据此标记任务状态）
        print(json.dumps(error_output, ensure_ascii=False), flush=True)
        return 2
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("未预期异常: %s", exc)
        error_output = {
            "adapter_version": ADAPTER_VERSION,
            "garak_version": "unknown",
            "scan_id": args.scan_id,
            "success": False,
            "probe_results": [],
            "metadata": {
                "model_provider": args.model_provider,
                "model_name": args.model_name,
                "error": f"未预期异常: {exc}",
            },
        }
        print(json.dumps(error_output, ensure_ascii=False), flush=True)
        return 2

    output_dict = result.to_dict(adapter_version=ADAPTER_VERSION)
    logger.info(
        "扫描完成: success=%s probe_results=%d",
        result.success,
        len(result.probe_results),
    )
    # 最终 JSON 输出到 stdout（Go 侧从最后一行解析）
    print(json.dumps(output_dict, ensure_ascii=False), flush=True)
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
