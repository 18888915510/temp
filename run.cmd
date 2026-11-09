@echo off
chcp 65001 >nul
rem 跨渠道跟进评测：双击运行，默认用 CodeAgent 的 GLM-5.2-WX-Auto 跑全部 7 个用例。
rem 换模型：run.cmd --model deepseek-v4.1-flash-1017
rem 结果在本文件夹里的 result-日期时间 文件夹中，打开 report.md 看逐项对错。
cd /d "%~dp0"
node followup-bench.js %*
pause
