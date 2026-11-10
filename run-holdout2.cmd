@echo off
chcp 65001 >nul
rem 第二轮修改后的验收（约 25 分钟），每步跑完自动上传数字报告：
rem   1. 召回：H1~H5（看 H5 漏的消息找回没有）  2. 召回：旧 7 题（看有没有退步）
rem   3. 干净消息：第三批新题 H6~H10 ×2 遍     4. 端到端：H6~H10
rem 规则：跑之前和跑完都不要修改任何脚本、提示词或题目。
cd /d "%~dp0"
set NOPAUSE=1
node recall-bench.js --file holdout.json --modes anchor
call upload.cmd
node recall-bench.js --file cases.json --modes anchor
call upload.cmd
node followup-bench.js --file holdout2.json --model deepseek-v4.1-flash-1017 --repeat 2
call upload.cmd
node e2e-bench.js --file holdout2.json --model deepseek-v4.1-flash-1017
call upload.cmd
