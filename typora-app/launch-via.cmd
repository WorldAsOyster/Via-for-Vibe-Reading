@echo off
setlocal
if "%~1"=="" exit /b 2
if not exist "%~dp0node_modules\electron\dist\electron.exe" exit /b 3
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." "--via-document=%~1"
