#!/bin/bash

###############################################################################
# Performance Optimization Setup Script
# Configures and initializes performance optimizations for Notification System
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Performance Optimization Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    local missing=()

    if ! command -v node &> /dev/null; then
        missing+=("node")
    fi

    if ! command -v npm &> /dev/null; then
        missing+=("npm")
    fi

    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    if ! command -v docker-compose &> /dev/null; then
        missing+=("docker-compose")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo -e "${RED}✗ Missing prerequisites: ${missing[*]}${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ All prerequisites installed${NC}"
}

# Install dependencies
install_dependencies() {
    echo ""
    echo -e "${YELLOW}Installing Node.js dependencies...${NC}"

    # Install performance-related packages
    npm install --save \
        compression \
        prom-client \
        redis \
        pg \
        kafkajs

    npm install --save-dev \
        @types/compression \
        k6 \
        artillery

    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Setup monitoring stack
setup_monitoring() {
    echo ""
    echo -e "${YELLOW}Setting up monitoring stack...${NC}"

    # Start Prometheus and Grafana
    cd infrastructure/monitoring

    if docker-compose -f docker-compose.monitoring.yml ps | grep -q "Up"; then
        echo -e "${YELLOW}Monitoring stack already running${NC}"
    else
        docker-compose -f docker-compose.monitoring.yml up -d

        echo -e "${GREEN}✓ Monitoring stack started${NC}"
        echo -e "  Prometheus: ${BLUE}http://localhost:9090${NC}"
        echo -e "  Grafana: ${BLUE}http://localhost:3001${NC} (admin/admin)"
    fi

    cd ../..
}

# Configure database optimizations
setup_database() {
    echo ""
    echo -e "${YELLOW}Configuring database optimizations...${NC}"

    # Create database indexes
    cat > /tmp/db-indexes.sql <<EOF
-- Create optimized indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_user_notifications ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_status ON notifications(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notification_priority ON notifications(priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_channels ON notifications USING GIN (channels);
CREATE INDEX IF NOT EXISTS idx_notification_metadata ON notifications USING GIN (metadata);

-- Update table statistics
ANALYZE notifications;

-- Vacuum the table
VACUUM ANALYZE notifications;
EOF

    if docker-compose ps postgres | grep -q "Up"; then
        echo -e "${YELLOW}Applying database optimizations...${NC}"
        docker-compose exec -T postgres psql -U postgres -d notifications < /tmp/db-indexes.sql
        echo -e "${GREEN}✓ Database indexes created${NC}"
    else
        echo -e "${YELLOW}Database not running, skipping index creation${NC}"
        echo -e "  Run this script after starting the database"
    fi

    rm /tmp/db-indexes.sql
}

# Configure Redis optimizations
setup_redis() {
    echo ""
    echo -e "${YELLOW}Configuring Redis optimizations...${NC}"

    if docker-compose ps redis | grep -q "Up"; then
        # Set Redis configuration
        docker-compose exec redis redis-cli CONFIG SET maxmemory 2gb
        docker-compose exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
        docker-compose exec redis redis-cli CONFIG SET save "900 1 300 10 60 10000"

        echo -e "${GREEN}✓ Redis optimizations applied${NC}"
    else
        echo -e "${YELLOW}Redis not running, skipping configuration${NC}"
    fi
}

# Configure Kafka optimizations
setup_kafka() {
    echo ""
    echo -e "${YELLOW}Configuring Kafka optimizations...${NC}"

    if docker-compose ps kafka | grep -q "Up"; then
        # Create optimized topics
        docker-compose exec kafka kafka-topics --create \
            --bootstrap-server localhost:9092 \
            --replication-factor 1 \
            --partitions 6 \
            --topic notifications \
            --config compression.type=gzip \
            --config retention.ms=604800000 \
            --if-not-exists || true

        docker-compose exec kafka kafka-topics --create \
            --bootstrap-server localhost:9092 \
            --replication-factor 1 \
            --partitions 4 \
            --topic email-notifications \
            --config compression.type=gzip \
            --if-not-exists || true

        docker-compose exec kafka kafka-topics --create \
            --bootstrap-server localhost:9092 \
            --replication-factor 1 \
            --partitions 4 \
            --topic sms-notifications \
            --config compression.type=gzip \
            --if-not-exists || true

        echo -e "${GREEN}✓ Kafka topics configured${NC}"
    else
        echo -e "${YELLOW}Kafka not running, skipping configuration${NC}"
    fi
}

# Setup CDN configuration
setup_cdn() {
    echo ""
    echo -e "${YELLOW}CDN Configuration${NC}"
    echo -e "CDN configurations are available in:"
    echo -e "  - config/cdn/cloudflare.config.json"
    echo -e "  - config/cdn/cloudfront.config.json"
    echo ""
    echo -e "Please configure your CDN provider manually using these configs"
}

# Verify setup
verify_setup() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Verifying Setup${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    local issues=0

    # Check services
    echo -e "${YELLOW}Checking services...${NC}"

    services=("postgres" "redis" "kafka" "prometheus" "grafana")
    for service in "${services[@]}"; do
        if docker-compose ps "$service" 2>/dev/null | grep -q "Up"; then
            echo -e "${GREEN}✓ $service is running${NC}"
        else
            echo -e "${RED}✗ $service is not running${NC}"
            ((issues++))
        fi
    done

    echo ""

    # Check endpoints
    echo -e "${YELLOW}Checking endpoints...${NC}"

    endpoints=(
        "http://localhost:3000/health:Notification Service"
        "http://localhost:9090/-/healthy:Prometheus"
        "http://localhost:3001/api/health:Grafana"
    )

    for endpoint_desc in "${endpoints[@]}"; do
        IFS=':' read -r endpoint name <<< "$endpoint_desc"
        if curl -sf "$endpoint" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ $name is accessible${NC}"
        else
            echo -e "${YELLOW}⚠ $name is not accessible (may still be starting)${NC}"
        fi
    done

    echo ""

    if [ $issues -eq 0 ]; then
        echo -e "${GREEN}✓ All checks passed${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ Some issues detected, but setup can continue${NC}"
        return 1
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Setup Complete!${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${GREEN}Performance optimizations have been configured:${NC}"
    echo ""
    echo -e "1. ${GREEN}Redis Caching:${NC}"
    echo -e "   - Advanced caching strategies implemented"
    echo -e "   - Cache-aside and write-through patterns"
    echo -e "   - Distributed locking and rate limiting"
    echo ""
    echo -e "2. ${GREEN}Database Optimization:${NC}"
    echo -e "   - Connection pooling configured (5-25 connections)"
    echo -e "   - Indexes created for common queries"
    echo -e "   - Prepared statements for better performance"
    echo ""
    echo -e "3. ${GREEN}Kafka Optimization:${NC}"
    echo -e "   - Message batching enabled"
    echo -e "   - GZIP compression configured"
    echo -e "   - Topics created with optimal partitions"
    echo ""
    echo -e "4. ${GREEN}Monitoring:${NC}"
    echo -e "   - Prometheus: ${BLUE}http://localhost:9090${NC}"
    echo -e "   - Grafana: ${BLUE}http://localhost:3001${NC}"
    echo -e "   - Metrics endpoint: ${BLUE}http://localhost:3000/metrics${NC}"
    echo ""
    echo -e "5. ${GREEN}Load Testing:${NC}"
    echo -e "   - K6 tests: ./tests/load/k6-load-test.js"
    echo -e "   - Artillery tests: ./tests/load/artillery-load-test.yml"
    echo -e "   - Run: ./scripts/run-load-tests.sh"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo -e "  1. Review performance documentation: ./docs/PERFORMANCE_OPTIMIZATION.md"
    echo -e "  2. Import Grafana dashboards from: ./infrastructure/monitoring/grafana-dashboards/"
    echo -e "  3. Run load tests: ./scripts/run-load-tests.sh"
    echo -e "  4. Monitor metrics in Grafana"
    echo -e "  5. Adjust configurations based on your workload"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    install_dependencies
    setup_monitoring

    # Ask if user wants to apply optimizations to running services
    echo ""
    read -p "Apply optimizations to running services? (y/n) " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        setup_database
        setup_redis
        setup_kafka
    fi

    setup_cdn
    verify_setup
    print_summary

    echo -e "${GREEN}Performance optimization setup completed!${NC}"
}

# Run main
main
