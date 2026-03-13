@echo off
REM Simple Docker run script for Agentic Runtime (Windows)
REM This replaces the complex docker-compose setup

setlocal enabledelayedexpansion

REM Default values
set IMAGE_NAME=agentic-runtime
set CONTAINER_NAME=agentic-runtime
set PORT=8000
set WORKSPACE_DIR=.\workspace
set DATA_DIR=.\backend\data

REM Create directories if they don't exist
if not exist "%WORKSPACE_DIR%" mkdir "%WORKSPACE_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM Check if backend .env file exists
if not exist "backend\.env" (
    echo Warning: backend\.env file not found. Copy backend\.env.example to backend\.env and configure your API keys.
    echo Example: copy backend\.env.example backend\.env
    exit /b 1
)

REM Build the image
echo Building Docker image...
docker build -t %IMAGE_NAME% .

REM Stop and remove existing container if it exists
docker ps -a --format "table {{.Names}}" | findstr /r "^%CONTAINER_NAME%$" >nul
if !errorlevel! equ 0 (
    echo Stopping and removing existing container...
    docker stop %CONTAINER_NAME% 2>nul
    docker rm %CONTAINER_NAME% 2>nul
)

REM Run the container
echo Starting container...
docker run -d ^
    --name %CONTAINER_NAME% ^
    -p 3000:3000 ^
    -p %PORT%:8000 ^
    -v "%cd%\%WORKSPACE_DIR%:/workspace" ^
    -v "%cd%\%DATA_DIR%:/app/backend/data" ^
    -v "%cd%\%WORKSPACE_DIR%\.logs:/workspace/.logs" ^
    --env-file backend\.env ^
    --restart unless-stopped ^
    %IMAGE_NAME%

echo Container started successfully!
echo Frontend available at: http://localhost:3000
echo API available at: http://localhost:%PORT%
echo Health check: http://localhost:%PORT%/health
echo.
echo To view logs: docker logs -f %CONTAINER_NAME%
echo To stop: docker stop %CONTAINER_NAME%
echo To remove: docker rm %CONTAINER_NAME%

pause