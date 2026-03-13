#!/bin/bash

# Simple Docker run script for Agentic Runtime
# This replaces the complex docker-compose setup

set -e

# Default values
IMAGE_NAME="agentic-runtime"
CONTAINER_NAME="agentic-runtime"
PORT="8000"
WORKSPACE_DIR="./workspace"
DATA_DIR="./backend/data"

# Create directories if they don't exist
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$DATA_DIR"

# Check if backend .env file exists
if [ ! -f "backend/.env" ]; then
    echo "Warning: backend/.env file not found. Copy backend/.env.example to backend/.env and configure your API keys."
    echo "Example: cp backend/.env.example backend/.env"
    exit 1
fi

# Build the image
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

# Stop and remove existing container if it exists
if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping and removing existing container..."
    docker stop "$CONTAINER_NAME" || true
    docker rm "$CONTAINER_NAME" || true
fi

# Run the container
echo "Starting container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "3000:3000" \
    -p "$PORT:8000" \
    -v "$(pwd)/$WORKSPACE_DIR:/workspace" \
    -v "$(pwd)/$DATA_DIR:/app/backend/data" \
    -v "$(pwd)/$WORKSPACE_DIR/.logs:/workspace/.logs" \
    --env-file backend/.env \
    --restart unless-stopped \
    "$IMAGE_NAME"

echo "Container started successfully!"
echo "Frontend available at: http://localhost:3000"
echo "API available at: http://localhost:$PORT"
echo "Health check: http://localhost:$PORT/health"
echo ""
echo "To view logs: docker logs -f $CONTAINER_NAME"
echo "To stop: docker stop $CONTAINER_NAME"
echo "To remove: docker rm $CONTAINER_NAME"