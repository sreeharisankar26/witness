@echo off
REM ============================================================================
REM  Witness — let your phone reach this PC
REM
REM  RIGHT-CLICK THIS FILE AND CHOOSE "Run as administrator".
REM  Adding a firewall rule needs admin rights; a normal double-click will fail.
REM
REM  Windows blocks incoming connections to Node by default. Everything works on
REM  the laptop (localhost is never blocked) while the phone gets nothing, which
REM  makes it look like an app bug rather than a firewall one.
REM ============================================================================
title Witness - firewall rules

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   NOT RUNNING AS ADMINISTRATOR.
  echo.
  echo   Close this, right-click allow-firewall.bat, and choose
  echo   "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo.
echo   Allowing your phone to reach this PC on the site network...
echo.

REM Remove any earlier copies so repeated runs do not stack up duplicates.
netsh advfirewall firewall delete rule name="Witness sync server (8787)" >nul 2>&1
netsh advfirewall firewall delete rule name="Witness Metro (8081-8090)" >nul 2>&1

netsh advfirewall firewall add rule ^
  name="Witness sync server (8787)" ^
  dir=in action=allow protocol=TCP localport=8787 ^
  profile=private,domain

netsh advfirewall firewall add rule ^
  name="Witness Metro (8081-8090)" ^
  dir=in action=allow protocol=TCP localport=8081-8090 ^
  profile=private,domain

echo.
echo   Done. Two rules added, for private and domain networks only —
echo   deliberately NOT for public networks.
echo.
echo   If your wifi is currently marked "Public", Windows will still block it.
echo   Settings ^> Network ^& Internet ^> Wi-Fi ^> your network ^> set to Private.
echo.
echo   Now scan the health-check QR in the control panel with your phone.
echo   It should show {"ok":true}.
echo.
pause
