#!/usr/bin/env bash
# =============================================================================
# NetX Docker Startup Script — Linux / macOS
# =============================================================================
set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}              NETX DOCKER STARTUP CONTROLLER (Linux/macOS)           ${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo ""

# Step 1: Check Docker
echo -e "${YELLOW}[+] Step 1: Checking Docker availability...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[-] Error: Docker is not installed or not in PATH.${NC}"
    echo "    Install Docker: https://docs.docker.com/engine/install/"
    exit 1
fi
if ! docker info &> /dev/null; then
    echo -e "${RED}[-] Error: Docker daemon is not running. Please start Docker first.${NC}"
    exit 1
fi
echo -e "${GREEN}[✓] Docker is running.${NC}"
echo ""

# Step 2: Check if port 514 needs root / kernel capability
echo -e "${YELLOW}[+] Step 2: Checking port 514 binding permissions...${NC}"
# On Linux, ports below 1024 require root or net.ipv4.ip_unprivileged_port_start setting
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    UNPRIVILEGED_START=$(cat /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || echo "1024")
    if [[ "$UNPRIVILEGED_START" -gt 514 ]]; then
        echo -e "${YELLOW}    [!] Linux: Port 514 requires elevated privileges.${NC}"
        echo -e "${YELLOW}    [!] Attempting to lower unprivileged port start to 514...${NC}"
        if sudo sysctl -w net.ipv4.ip_unprivileged_port_start=514 &> /dev/null; then
            echo -e "${GREEN}    [✓] Set net.ipv4.ip_unprivileged_port_start=514 (temporary, resets on reboot).${NC}"
            echo -e "    To make it permanent, add to /etc/sysctl.conf:"
            echo -e "        net.ipv4.ip_unprivileged_port_start=514"
        else
            echo -e "${YELLOW}    [!] Could not set sysctl. Syslog will fall back to port 5140.${NC}"
            echo -e "    Configure your devices to send syslog to port 5140 instead."
        fi
    else
        echo -e "${GREEN}    [✓] Port 514 is accessible (unprivileged_port_start=${UNPRIVILEGED_START}).${NC}"
    fi
else
    echo -e "${GREEN}    [✓] macOS detected — Docker Desktop handles port binding internally.${NC}"
fi
echo ""

# Step 3: Start Docker Compose
echo -e "${YELLOW}[+] Step 3: Starting NetX Docker Compose services...${NC}"
echo -e "    (API, Worker, Scheduler, Syslog, PostgreSQL, Redis)"
docker compose up -d
if [[ $? -ne 0 ]]; then
    echo -e "${RED}[-] Error: docker compose failed to start.${NC}"
    exit 1
fi
echo -e "${GREEN}[✓] Docker containers are running.${NC}"
echo ""

# Step 4: Check if frontend dev server is needed
echo -e "${YELLOW}[+] Step 4: Checking frontend...${NC}"
if command -v npm &> /dev/null; then
    echo -e "    Starting Vite dev server in background..."
    cd frontend
    npm install --silent 2>/dev/null || true
    npm run dev &
    FRONTEND_PID=$!
    cd ..
    echo -e "${GREEN}[✓] Frontend dev server started (PID: $FRONTEND_PID).${NC}"
    FRONTEND_URL="http://localhost:5173/"
else
    echo -e "${YELLOW}    [!] npm not found. Frontend dev server not started.${NC}"
    echo -e "    Serving built frontend directly from API at: http://localhost:8000/"
    FRONTEND_URL="http://localhost:8000/"
fi
echo ""

# Step 5: Wait for services
echo -e "${YELLOW}[+] Step 5: Waiting for services to initialize (5 seconds)...${NC}"
sleep 5
echo ""

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}  NetX is now running!${NC}"
echo -e "  - Local Access:  ${FRONTEND_URL}"
echo -e "  - Backend API:   http://localhost:8000/"
echo -e "  - API Docs:      http://localhost:8000/api/docs"
echo -e "  - Syslog:        UDP port 514 (or fallback 5140)"
echo ""
echo -e "  Useful commands:"
echo -e "    docker compose logs -f          # view all service logs"
echo -e "    docker compose logs -f syslog   # view syslog service logs"
echo -e "    docker compose down             # stop all services"
echo -e "${BLUE}======================================================================${NC}"
