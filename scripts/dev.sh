#!/bin/bash

# BiosBot Build and Run Script
# Usage: ./scripts/dev.sh [command]

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

COMMAND=${1:-"all"}

log() {
    echo "[BiosBot] $1"
}

log_success() {
    echo "[BiosBot] ✓ $1"
}

log_error() {
    echo "[BiosBot] ✗ $1"
}

check_node() {
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    log_success "Node.js version: $(node --version)"
}

install_deps() {
    log "Installing dependencies..."
    
    if [ -d "backend" ]; then
        log "Installing backend dependencies..."
        cd backend
        npm install
        cd ..
    fi
    
    if [ -d "web" ]; then
        log "Installing web dependencies..."
        cd web
        npm install
        cd ..
    fi
    
    log_success "Dependencies installed"
}

init_db() {
    log "Initializing database..."
    
    cd backend
    
    if [ ! -d "data" ]; then
        mkdir -p data
    fi
    
    npx drizzle-kit push:sqlite 2>/dev/null || true
    
    if [ -f "src/db/init.ts" ]; then
        npx tsx src/db/init.ts
    fi
    
    cd ..
    log_success "Database initialized"
}

build() {
    log "Building project..."
    
    if [ -d "web" ]; then
        log "Building web..."
        cd web
        npm run build
        cd ..
    fi
    
    if [ -d "backend" ]; then
        log "Building backend..."
        cd backend
        npm run build
        cd ..
    fi
    
    log_success "Build complete"
}

dev_backend() {
    log "Starting backend development server..."
    cd backend
    npm run dev
}

dev_web() {
    log "Starting web development server..."
    cd web
    npm run dev
}

dev_all() {
    log "Starting all development servers..."
    
    # Start backend in background
    cd backend
    npm run dev &
    BACKEND_PID=$!
    cd ..
    
    # Wait a bit for backend to start
    sleep 3
    
    # Start web in foreground
    cd web
    npm run dev
    
    # Cleanup
    kill $BACKEND_PID 2>/dev/null || true
}

start_backend() {
    log "Starting backend production server..."
    cd backend
    npm start
}

start_web() {
    log "Starting web production server..."
    cd web
    npm run preview
}

case "$COMMAND" in
    "install")
        check_node
        install_deps
        ;;
    "init")
        init_db
        ;;
    "build")
        check_node
        build
        ;;
    "dev:backend")
        check_node
        install_deps
        init_db
        dev_backend
        ;;
    "dev:web")
        check_node
        install_deps
        dev_web
        ;;
    "dev"|"all")
        check_node
        install_deps
        init_db
        dev_all
        ;;
    "start")
        check_node
        build
        start_backend
        ;;
    "help"|"-h"|"--help")
        echo "BiosBot Build and Run Script"
        echo ""
        echo "Usage: ./scripts/dev.sh [command]"
        echo ""
        echo "Commands:"
        echo "  install      Install all dependencies"
        echo "  init          Initialize database"
        echo "  build         Build the project"
        echo "  dev:backend   Start backend development server"
        echo "  dev:web       Start web development server"
        echo "  dev           Start all development servers"
        echo "  start         Start production server"
        echo "  help          Show this help message"
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        echo "Run './scripts/dev.sh help' for usage information"
        exit 1
        ;;
esac
