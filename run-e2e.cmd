@echo off
chcp 65001 >nul
rem 跨渠道跟进 · 端到端评测：召回（含真实消息）→ flash 模型整理 → 比对。约 10 分钟。
rem 真实消息会作为候选发给公司 CodeAgent 模型（和助理每日简报同一通道）；含真实消息的提问和输出只留在 local-only 文件夹，不上传。
rem 结果在本文件夹的 e2e-日期时间 文件夹中，report.md 可以上传。
cd /d "%~dp0"
node e2e-bench.js --model deepseek-v4.1-flash-1017 %*
