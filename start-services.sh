#!/bin/bash

# Start both frontend and backend services in Docker container

set -e

echo "Starting Agentic Runtime services..."

# Start Next.js frontend in the background
echo "Starting frontend (Next.js)..."
cd /app/frontend
npm start &
FRONTEND_PID=$!

# Start FastAPI backend in the background  
echo "Starting backend (FastAPI)..."
cd /app/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Function to cleanup processes on exit
cleanup() {
    echo "Shutting down services..."
    kill $FRONTEND_PID $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID $BACKEND_PID 2>/dev/null || true
    echo "Services stopped."
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

echo "Services started:"
echo "  - Frontend (Next.js): http://localhost:3000"
echo "  - Backend (FastAPI): http://localhost:8000"
echo "  - Health check: http://localhost:8000/health"

# Wait for both processes
wait $FRONTEND_PID $BACKEND_PID