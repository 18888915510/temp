@echo off
chcp 65001 >nul
rem 第三轮修改（召回「宁多勿漏」）后的验收，约 30 分钟，每步跑完自动上传数字报告：
rem   1~3. 召回：H1~H5、旧 7 题、H6~H10（都是看过的题，查有没有漏、有没有退步）
rem   4. 干净消息：第四批新题 H11~H15 ×2 遍     5. 端到端：H11~H15（验收主考）
rem   6. 端到端：H6~H10（回归：真实噪音下候选变多后，结果和耗时如何）
rem 规则：跑之前和跑完都不要修改任何脚本、提示词或题目。
cd /d "%~dp0"
set NOPAUSE=1
node recall-bench.js --file holdout.json --modes anchor
call upload.cmd
node recall-bench.js --file cases.json --modes anchor
call upload.cmd
node recall-bench.js --file holdout2.json --modes anchor
call upload.cmd
node followup-bench.js --file holdout3.json --model deepseek-v4.1-flash-1017 --repeat 2
call upload.cmd
node e2e-bench.js --file holdout3.json --model deepseek-v4.1-flash-1017
call upload.cmd
node e2e-bench.js --file holdout2.json --model deepseek-v4.1-flash-1017
call upload.cmd
