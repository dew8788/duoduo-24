@echo off
chcp 65001 >nul
title Duoduo 24 - Local Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting... (keep this window open while playing on iPad)
echo.

node tools\serve.mjs %1

echo.
echo   Server stopped.
pause
