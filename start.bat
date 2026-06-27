@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

REM Uncomment to pin a model and ignore whatever MCM is set to:
REM set FORCE_MODEL=flash

REM Requires Antigravity CLI (`agy`) to be installed and logged in.
REM The server captures `agy --print` through a PTY.
REM Optional: pin an Antigravity model, otherwise your AGY default is used.
REM set AGY_MODEL=gemini-3.5-flash
REM Prompt mode: file avoids Windows command-line length limits.
REM set AGY_PROMPT_MODE=file
REM Optional temp root for per-request prompt files.
REM set AGY_PROMPT_DIR=%TEMP%
REM Windows default: reuse one PTY so per-request AGY calls do not steal game focus.
REM set AGY_REUSE_WINDOWS_PTY=1
REM Optional: auto-approve AGY tool permissions. Use only if you trust the prompt.
REM set AGY_SKIP_PERMISSIONS=1

node server.js
pause
