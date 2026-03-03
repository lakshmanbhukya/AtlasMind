@echo off
echo ==========================================
echo 🚀 Starting AtlasMind (Client + Server)
echo ==========================================

:: Start Backend Server
echo 📂 Starting Backend Server (Port 3001)...
start cmd /k "cd server && npm run dev"

:: Start Frontend Client
echo 📂 Starting Frontend Client (Port 5173)...
start cmd /k "cd client && npm run dev"

echo.
echo ✅ Both processes are starting in separate windows.
echo 🌐 Frontend: http://localhost:5173
echo 🔌 Backend: http://localhost:3001
echo ==========================================
pause
