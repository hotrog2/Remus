@echo off
setlocal

pushd "%~dp0"
call npm.cmd install
if errorlevel 1 (
  popd
  exit /b 1
)

call npm.cmd run build:app
set "EXIT_CODE=%ERRORLEVEL%"
popd

if %EXIT_CODE% neq 0 exit /b %EXIT_CODE%
echo Client EXE build complete. Check release\Remus-win32-x64\Remus.exe
exit /b 0
