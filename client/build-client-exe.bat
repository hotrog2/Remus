@echo off
setlocal

pushd "%~dp0"
call npm.cmd install
if errorlevel 1 (
  popd
  exit /b 1
)

call npm.cmd run build:exe
set "EXIT_CODE=%ERRORLEVEL%"
popd

if %EXIT_CODE% neq 0 exit /b %EXIT_CODE%
echo Client EXE build complete. Check release\Remus Client 1.0.0.exe
exit /b 0
