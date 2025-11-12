#!/bin/bash

# Automated Deployment Script for Notification System
# This script will deploy all services to Render.com

set -e

echo "🚀 Starting deployment to Render..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if render CLI is installed
if ! command -v render &> /dev/null; then
    echo -e "${RED}Render CLI not found. Installing...${NC}"
    npm install -g @render-com/cli
fi

# Login to Render (if not already)
echo -e "${BLUE}Logging into Render...${NC}"
render login

# Deploy using Blueprint
echo -e "${BLUE}Deploying services using Blueprint...${NC}"
render blueprint deploy

echo -e "${GREEN}✅ Deployment initiated!${NC}"
echo ""
echo "Check status at: https://dashboard.render.com"
echo ""
echo "Services will be available at:"
echo "  - API: https://notification-api.onrender.com"
echo "  - In-App: https://inapp-service.onrender.com"
echo ""
echo "⏰ Deployment takes ~5-10 minutes"
echo "💤 You can sleep now - it will be ready when you wake up!"
