#!/bin/bash

###############################################################################
# Load Testing Script for Notification System
# Runs both K6 and Artillery load tests with various scenarios
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_DIR="./test-results/$(date +%Y%m%d-%H%M%S)"
K6_TEST_FILE="./tests/load/k6-load-test.js"
ARTILLERY_TEST_FILE="./tests/load/artillery-load-test.yml"

# Create results directory
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Notification System Load Testing${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Target URL: ${GREEN}$BASE_URL${NC}"
echo -e "Results Directory: ${GREEN}$RESULTS_DIR${NC}"
echo ""

# Function to check if service is healthy
check_health() {
    echo -e "${YELLOW}Checking service health...${NC}"

    if curl -sf "$BASE_URL/health" > /dev/null; then
        echo -e "${GREEN}✓ Service is healthy${NC}"
        return 0
    else
        echo -e "${RED}✗ Service is not responding${NC}"
        return 1
    fi
}

# Function to run K6 tests
run_k6_tests() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Running K6 Load Tests${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    if ! command -v k6 &> /dev/null; then
        echo -e "${RED}✗ K6 is not installed. Please install it first.${NC}"
        echo -e "  Visit: https://k6.io/docs/getting-started/installation/"
        return 1
    fi

    # Smoke test
    echo -e "${YELLOW}Running K6 Smoke Test...${NC}"
    k6 run \
        --env BASE_URL="$BASE_URL" \
        --out json="$RESULTS_DIR/k6-smoke-test.json" \
        --summary-export="$RESULTS_DIR/k6-smoke-summary.json" \
        --tag testid=smoke \
        "$K6_TEST_FILE" | tee "$RESULTS_DIR/k6-smoke-test.log"

    echo ""
    echo -e "${GREEN}✓ K6 Smoke Test completed${NC}"
    echo -e "  Results: ${RESULTS_DIR}/k6-smoke-test.json"

    # Ask user if they want to continue
    echo ""
    read -p "Continue with full load tests? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Skipping remaining K6 tests${NC}"
        return 0
    fi

    # Load test
    echo ""
    echo -e "${YELLOW}Running K6 Load Test...${NC}"
    k6 run \
        --env BASE_URL="$BASE_URL" \
        --out json="$RESULTS_DIR/k6-load-test.json" \
        --summary-export="$RESULTS_DIR/k6-load-summary.json" \
        --tag testid=load \
        "$K6_TEST_FILE" | tee "$RESULTS_DIR/k6-load-test.log"

    echo ""
    echo -e "${GREEN}✓ K6 Load Test completed${NC}"

    # Generate HTML report
    if [ -f "$RESULTS_DIR/k6-load-summary.json" ]; then
        echo -e "${YELLOW}Generating HTML report...${NC}"
        # You can use k6-reporter or custom script here
    fi

    echo ""
    echo -e "${GREEN}✓ All K6 tests completed${NC}"
}

# Function to run Artillery tests
run_artillery_tests() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Running Artillery Load Tests${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    if ! command -v artillery &> /dev/null; then
        echo -e "${RED}✗ Artillery is not installed. Installing...${NC}"
        npm install -g artillery
    fi

    echo -e "${YELLOW}Running Artillery Load Test...${NC}"

    artillery run \
        --target "$BASE_URL" \
        --output "$RESULTS_DIR/artillery-results.json" \
        "$ARTILLERY_TEST_FILE" | tee "$RESULTS_DIR/artillery-test.log"

    # Generate HTML report
    if [ -f "$RESULTS_DIR/artillery-results.json" ]; then
        echo ""
        echo -e "${YELLOW}Generating Artillery HTML report...${NC}"
        artillery report \
            "$RESULTS_DIR/artillery-results.json" \
            --output "$RESULTS_DIR/artillery-report.html"

        echo -e "${GREEN}✓ HTML report generated: ${RESULTS_DIR}/artillery-report.html${NC}"
    fi

    echo ""
    echo -e "${GREEN}✓ Artillery tests completed${NC}"
}

# Function to generate summary
generate_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Test Summary${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    echo -e "${GREEN}Test Results Location:${NC}"
    echo -e "  $RESULTS_DIR"
    echo ""

    echo -e "${GREEN}Generated Files:${NC}"
    ls -lh "$RESULTS_DIR" | awk '{if (NR>1) print "  " $9 " (" $5 ")"}'
    echo ""

    # Open HTML reports if available
    if command -v open &> /dev/null; then
        echo -e "${YELLOW}Opening HTML reports...${NC}"

        if [ -f "$RESULTS_DIR/artillery-report.html" ]; then
            open "$RESULTS_DIR/artillery-report.html"
        fi

        if [ -f "$RESULTS_DIR/summary.html" ]; then
            open "$RESULTS_DIR/summary.html"
        fi
    fi
}

# Function to analyze results
analyze_results() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Performance Analysis${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    # Parse K6 results
    if [ -f "$RESULTS_DIR/k6-load-summary.json" ]; then
        echo -e "${GREEN}K6 Performance Metrics:${NC}"

        # Extract key metrics using jq if available
        if command -v jq &> /dev/null; then
            echo -e "  HTTP Request Duration (P95): $(jq -r '.metrics.http_req_duration.values["p(95)"]' "$RESULTS_DIR/k6-load-summary.json")ms"
            echo -e "  Error Rate: $(jq -r '.metrics.errors.values.rate * 100' "$RESULTS_DIR/k6-load-summary.json")%"
            echo -e "  Requests/sec: $(jq -r '.metrics.http_reqs.values.rate' "$RESULTS_DIR/k6-load-summary.json")"
        else
            echo -e "  ${YELLOW}Install 'jq' for detailed metrics analysis${NC}"
        fi
        echo ""
    fi

    # Performance recommendations
    echo -e "${YELLOW}Performance Recommendations:${NC}"
    echo -e "  1. Review response times > 500ms"
    echo -e "  2. Investigate error rates > 1%"
    echo -e "  3. Check database connection pool usage"
    echo -e "  4. Monitor Redis cache hit rates"
    echo -e "  5. Verify Kafka consumer lag"
    echo ""
}

# Main execution
main() {
    # Check prerequisites
    if ! check_health; then
        echo -e "${RED}Please start the notification system first${NC}"
        exit 1
    fi

    # Run tests based on user selection
    echo ""
    echo -e "${YELLOW}Select test suite to run:${NC}"
    echo "  1) K6 only"
    echo "  2) Artillery only"
    echo "  3) Both K6 and Artillery"
    echo "  4) Quick smoke test only"
    echo ""
    read -p "Enter choice [1-4]: " choice

    case $choice in
        1)
            run_k6_tests
            ;;
        2)
            run_artillery_tests
            ;;
        3)
            run_k6_tests
            run_artillery_tests
            ;;
        4)
            echo -e "${YELLOW}Running quick smoke test...${NC}"
            k6 run \
                --env BASE_URL="$BASE_URL" \
                --vus 5 \
                --duration 1m \
                "$K6_TEST_FILE"
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac

    # Generate summary and analysis
    generate_summary
    analyze_results

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Load Testing Completed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. Review test results in: ${RESULTS_DIR}"
    echo -e "  2. Check Grafana dashboards: http://localhost:3001"
    echo -e "  3. Analyze Prometheus metrics: http://localhost:9090"
    echo -e "  4. Review application logs"
    echo ""
}

# Run main function
main
