@echo off
color 0b
echo ===================================================
echo   Vishva ERP - AI-Powered Multi-College Platform
echo ===================================================
echo.
echo Installing dependencies if missing...
call npm install

echo.
echo Starting Backend Server...
start cmd /k "npm run dev"

echo.
echo Starting Frontend File Server (Wait a few seconds)...
timeout /t 3 >nul

echo Starting browser...
start http://localhost:3000

echo To serve frontend properly, we recommend using a simple static server like 'serve' or 'live-server' pointing to frontend/ folder.
echo You can run: npx serve frontend -l 3000

pause
