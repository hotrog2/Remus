@echo off
setlocal

echo Installing central backend dependencies...
pushd "%~dp0server"
call npm.cmd install
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo Installing community-server dependencies...
pushd "%~dp0community-server"
call npm.cmd install
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo Installing client dependencies...
pushd "%~dp0client"
call npm.cmd install
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo Setup complete.
exit /b 0