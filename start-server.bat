@echo off
chcp 65001 >nul
title May chu tinh cong
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua cai Node.js. Tai tai https://nodejs.org ^(ban LTS^) roi chay lai. & pause & exit /b 1)
if not exist node_modules\xlsx (
  echo Dang cai thu vien lan dau...
  call npm install --omit=dev
)
node server.js
pause
