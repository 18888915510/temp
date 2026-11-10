@echo off
chcp 65001 >nul
rem 把最新一次评测结果上传到仓库（只传 report.md 和 summary.json；local-only-detail.md 含真实消息，永远不传）。
cd /d "%~dp0"
set "LATEST="
for /f "delims=" %%d in ('dir /b /ad /o-d diag-* e2e-* recall-* result-* 2^>nul') do if not defined LATEST set "LATEST=%%d"
if not defined LATEST (
  echo 没找到结果文件夹，请先运行 run-recall.cmd 或 run.cmd
  if not defined NOPAUSE pause
  exit /b 1
)
if not exist results mkdir results
copy /y "%LATEST%\report.md" "results\%LATEST%.md" >nul
if exist "%LATEST%\summary.json" copy /y "%LATEST%\summary.json" "results\%LATEST%.json" >nul
git pull -q
git add results
git -c user.name=eval-upload -c user.email=18888915510@163.com commit -q -m "上传评测结果 %LATEST%"
git push -q
if errorlevel 1 (
  echo 上传失败：如果弹出了 GitHub 登录，请登录后再运行一次本文件
) else (
  echo 已上传 %LATEST%
)
if not defined NOPAUSE pause
