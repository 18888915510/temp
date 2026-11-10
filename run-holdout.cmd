@echo off
chcp 65001 >nul
rem 新场景验证（holdout.json，5 个没见过的用例）：先干净消息 ×2 遍，再端到端；每步跑完自动上传数字报告。约 15 分钟。
rem 规则：跑之前和跑完都不要根据这些题修改提示词或评分。
cd /d "%~dp0"
set NOPAUSE=1
node followup-bench.js --file holdout.json --model deepseek-v4.1-flash-1017 --repeat 2
call upload.cmd
node e2e-bench.js --file holdout.json --model deepseek-v4.1-flash-1017
call upload.cmd
