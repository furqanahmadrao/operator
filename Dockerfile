# Single-stage Dockerfile for Agentic Runtime
# Simplified container with Python, Node.js, and browser support

FROM node:20-bookworm-slim

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    WORKSPACE_ROOT=/workspace \
    DB_PATH=/app/backend/data/agent.db \
    NODE_ENV=production

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Python 3.11 runtime
    python3.11 \
    python3.11-venv \
    python3-pip \
    # System tools
    git \
    curl \
    wget \
    build-essential \
    # Chromium and dependencies
    chromium \
    chromium-driver \
    # Additional browser dependencies
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create application directory
WORKDIR /app

# Copy and install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --only=production

# Copy frontend source and build
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt ./backend/
RUN pip3 install --no-cache-dir -r backend/requirements.txt

# Install Playwright browsers (Chromium)
RUN playwright install chromium --with-deps

# Copy backend application code
COPY backend/ ./backend/

# Create workspace directory with appropriate permissions
RUN mkdir -p /workspace && chmod 777 /workspace

# Create backend data directory
RUN mkdir -p /app/backend/data && chmod 777 /app/backend/data

# Create logs directory
RUN mkdir -p /workspace/.logs && chmod 777 /workspace/.logs

# Copy startup script
COPY start-services.sh /app/
RUN chmod +x /app/start-services.sh

# Expose both ports
EXPOSE 3000 8000

# Add health check for backend
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Set working directory to app root
WORKDIR /app

# Start both services
CMD ["/app/start-services.sh"]