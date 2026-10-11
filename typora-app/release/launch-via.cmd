@echo off
setlocal
if "%~1"=="" exit /b 2
if not exist "%~dp0ViaLocal.exe" exit /b 3
start "" "%~dp0ViaLocal.exe" "--via-document=%~1"
