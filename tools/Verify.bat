@echo off
title Witness verify
cd /d "%~dp0.."
echo Verifying the control panel end to end. This takes up to two minutes.
echo.
node "tools\verify.mjs"
echo.
echo Done. You can close this window.
timeout /t 10 >nul
