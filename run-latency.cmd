@echo off
chcp 65001 >nul
rem 耗时实验（约 25 分钟），全部逐个顺序运行、超时临时放到 600 秒以看清真实耗时；每步只上传数字报告。
rem   1~2. 对照：flash 默认档，H11（复杂）+ H13（简单），A 组，2 轮 —— 看是 H11 本身慢还是此刻服务整体慢
rem   3~4. flash + 思考档 low，H11，A 组，2 轮 —— 看推理长度是不是主因
rem   5~6. GLM-5.2-WX-Auto 默认档，H11，A 组，2 轮 —— 看是不是 flash 特有
rem   7.   flash + 思考档 low，H11~H15 全部，A 组 1 轮 —— 看降档后准确率掉不掉
rem 规则：不修改任何脚本、提示词或题目。
cd /d "%~dp0"
set NOPAUSE=1
set M=deepseek-v4.1-flash-1017
for /l %%i in (1,1,2) do (
  node e2e-bench.js --file holdout3.json --cases H11,H13 --variants A --parallel 1 --timeout 600 --model %M%
  call upload.cmd
)
for /l %%i in (1,1,2) do (
  node e2e-bench.js --file holdout3.json --cases H11 --variants A --parallel 1 --timeout 600 --model %M% --effort low
  call upload.cmd
)
for /l %%i in (1,1,2) do (
  node e2e-bench.js --file holdout3.json --cases H11 --variants A --parallel 1 --timeout 600 --model GLM-5.2-WX-Auto
  call upload.cmd
)
node e2e-bench.js --file holdout3.json --variants A --parallel 1 --timeout 600 --model %M% --effort low
call upload.cmd
