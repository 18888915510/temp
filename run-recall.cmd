@echo off
chcp 65001 >nul
rem 跨渠道跟进 · 召回评测：双击运行。读 Hub 存在本机的消息快照当背景噪音，不调 WeLink，不调模型，几秒钟跑完。
rem 结果在本文件夹里的 recall-日期时间 文件夹中，report.md 只有数字和编造的用例消息，可以发出来。
rem 助理目录不在默认位置时：run-recall.cmd --dir "助理目录路径"
cd /d "%~dp0"
node recall-bench.js %*
pause
