@echo off
chcp 65001 >nul
title Dat lai mat khau - Tinh cong
cd /d "%~dp0"
node reset-password.js
set /p U=Nhap ten dang nhap can dat lai mat khau (Enter de thoat): 
if "%U%"=="" exit /b 0
node reset-password.js %U%
pause
