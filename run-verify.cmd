@echo off
chcp 65001 >nul
rem 验证「当前用户回复接续」修复 + 收集耗时分布，约 15 分钟。每步只上传数字报告。
rem   1~3. 诊断：H5、H10、C5 那三条用户回复现在找没找到
rem   4~7. 召回回归：四套题（都是看过的题）
rem   8~10. 耗时：H11 的 A、B 两组，逐个顺序跑（不并发），重复 3 轮，看同一提问的耗时波动
rem 规则：不修改任何脚本、提示词或题目。
cd /d "%~dp0"
set NOPAUSE=1
node diag.js --file holdout.json --targets H5-G1-M3,H5-G1-M4
call upload.cmd
node diag.js --file holdout2.json --targets H10-G1-M2,H10-G1-M3
call upload.cmd
node diag.js --file cases.json --targets C5-G1-M1,C5-G1-M2
call upload.cmd
for %%f in (cases holdout holdout2 holdout3) do (
  node recall-bench.js --file %%f.json --modes anchor
  call upload.cmd
)
for /l %%i in (1,1,3) do (
  node e2e-bench.js --file holdout3.json --cases H11 --parallel 1 --model deepseek-v4.1-flash-1017
  call upload.cmd
)
