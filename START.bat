@echo off
title Vishva ERP - Development Server
color 0b

echo ===================================================
echo   Vishva ERP - AI-Powered Multi-College Platform
echo ===================================================
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo [1/3] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed. Check your connection and try again.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies found. Skipping install.
)

echo.
echo [2/3] Starting backend server on port 5000...
echo.

:: Check if MongoDB is running
echo Checking MongoDB connection...
echo (Make sure MongoDB is running on localhost:27017)
echo.

:: Start the backend server
start "VishvaERP Backend" cmd /k "npm run dev"

echo.
echo [3/3] Waiting for server to start...
timeout /t 3 /nobreak >nul

echo.
echo ===================================================
echo   Server should be running at:
echo   - Backend:  http://localhost:5000
echo   - Landing:  http://localhost:5000/
echo ===================================================
echo.
echo   Opening browser...
timeout /t 1 /nobreak >nul
start http://localhost:5000

echo.
echo   Press any key to open the login page directly...
pause >nul
start http://localhost:5000/pages/login.html

echo.
echo   Press Ctrl+C in the backend window to stop the server.
pause
