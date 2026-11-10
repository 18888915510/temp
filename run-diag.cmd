@echo off
chcp 65001 >nul
rem 只读诊断：不调模型、不调 WeLink、不改脚本和题目；每步只输出数字并上传。约 1 分钟。
cd /d "%~dp0"
set NOPAUSE=1
node diag.js --file holdout.json --targets H5-G1-M2,H5-G1-M3,H5-G1-M4
call upload.cmd
node diag.js --file holdout2.json --targets H10-G1-M2,H10-G1-M3
call upload.cmd
node diag.js --file cases.json --targets C5-G1-M1,C5-G1-M2
call upload.cmd
node diag.js --e2e e2e-2026-11-10T11-47-18
call upload.cmd
