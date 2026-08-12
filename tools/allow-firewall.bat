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

REM  profile=any, remoteip=localsubnet.
REM
REM  These rules used to be private+domain only. That is the safe-looking
REM  choice and it is wrong here: Windows classifies campus, hotel and most
REM  guest wifi as PUBLIC, so the rules existed, listed correctly, and let
REM  nothing through. The phone connected only on a home network, which made
REM  it look intermittent rather than blocked.
REM
REM  Opening them on any profile is made safe by remoteip=localsubnet: only
REM  machines on the same subnet can connect, never the internet.

netsh advfirewall firewall add rule ^
  name="Witness sync server (8787)" ^
  dir=in action=allow protocol=TCP localport=8787 ^
  remoteip=localsubnet profile=any

netsh advfirewall firewall add rule ^
  name="Witness Metro (8081-8090)" ^
  dir=in action=allow protocol=TCP localport=8081-8090 ^
  remoteip=localsubnet profile=any

echo.
echo   Done. Two rules added, on every network type but restricted to
echo   THIS SUBNET only - your phone can reach the laptop, the internet cannot.
echo.
echo   Now scan the health-check QR in the control panel with your phone.
echo   It should show {"ok":true}.
echo.
pause
