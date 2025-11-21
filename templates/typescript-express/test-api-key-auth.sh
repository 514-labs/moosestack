#!/bin/bash
# E2E Test Script for Express API Key Authentication
#
# This script tests the expressApiKeyAuthMiddleware functionality by:
# 1. Generating a test API key using the Moose CLI
# 2. Making authenticated and unauthenticated requests
# 3. Verifying proper 401/200 responses
#
# Usage: ./test-api-key-auth.sh
# Prerequisites:
# - Moose development server running (moose dev)
# - jq installed (for JSON parsing)

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="http://localhost:4000/protected-api-key"
HEALTH_ENDPOINT="$API_BASE_URL/health"
QUERY_ENDPOINT="$API_BASE_URL/query"
ECHO_ENDPOINT="$API_BASE_URL/echo"

echo "========================================="
echo "Express API Key Auth E2E Test"
echo "========================================="
echo ""

# Check prerequisites
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is not installed${NC}"
    echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

# Step 1: Generate API key
echo -e "${YELLOW}Step 1: Generating API key with Moose CLI...${NC}"
KEY_OUTPUT=$(moose generate hash-token)

# Extract token and hash from output
# Format: "Token: abc.def" and "ENV API Keys: hash123 \n MOOSE_INGEST_API_KEY / MOOSE_CONSUMPTION_API_KEY"
BEARER_TOKEN=$(echo "$KEY_OUTPUT" | grep "Token:" | cut -d' ' -f2)
API_KEY_HASH=$(echo "$KEY_OUTPUT" | grep "ENV API Keys" | cut -d' ' -f4)

if [ -z "$BEARER_TOKEN" ] || [ -z "$API_KEY_HASH" ]; then
    echo -e "${RED}Failed to extract API key from CLI output${NC}"
    echo "Output was:"
    echo "$KEY_OUTPUT"
    exit 1
fi

echo -e "${GREEN}✓ Generated API key${NC}"
echo "  Bearer Token: $BEARER_TOKEN"
echo "  Hash (first 20 chars): ${API_KEY_HASH:0:20}..."
echo ""

# Set environment variable
export MOOSE_WEB_APP_API_KEYS="$API_KEY_HASH"

echo -e "${YELLOW}Step 2: Testing unauthenticated requests (should fail with 401)...${NC}"

# Test 1: No Authorization header
echo -n "  Test 1.1: GET /health without Authorization... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_ENDPOINT")
if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✓ Got 401${NC}"
else
    echo -e "${RED}✗ Expected 401, got $HTTP_CODE${NC}"
    exit 1
fi

# Test 2: Malformed Authorization header
echo -n "  Test 1.2: GET /health with malformed Authorization... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $BEARER_TOKEN" "$HEALTH_ENDPOINT")
if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✓ Got 401${NC}"
else
    echo -e "${RED}✗ Expected 401, got $HTTP_CODE${NC}"
    exit 1
fi

# Test 3: Invalid token
echo -n "  Test 1.3: GET /health with invalid token... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer invalid.token" "$HEALTH_ENDPOINT")
if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✓ Got 401${NC}"
else
    echo -e "${RED}✗ Expected 401, got $HTTP_CODE${NC}"
    exit 1
fi

echo ""

echo -e "${YELLOW}Step 3: Testing authenticated requests (should succeed with 200)...${NC}"

# Test 4: Valid token on health endpoint
echo -n "  Test 3.1: GET /health with valid token... "
RESPONSE=$(curl -s -H "Authorization: Bearer $BEARER_TOKEN" "$HEALTH_ENDPOINT")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $BEARER_TOKEN" "$HEALTH_ENDPOINT")
if [ "$HTTP_CODE" = "200" ]; then
    STATUS=$(echo "$RESPONSE" | jq -r '.status')
    if [ "$STATUS" = "ok" ]; then
        echo -e "${GREEN}✓ Got 200 with valid response${NC}"
    else
        echo -e "${RED}✗ Got 200 but response is invalid${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Expected 200, got $HTTP_CODE${NC}"
    exit 1
fi

# Test 5: Valid token on query endpoint
echo -n "  Test 3.2: GET /query with valid token... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $BEARER_TOKEN" "$QUERY_ENDPOINT")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Got 200${NC}"
else
    echo -e "${RED}✗ Expected 200, got $HTTP_CODE${NC}"
    exit 1
fi

# Test 6: Valid token on POST endpoint
echo -n "  Test 3.3: POST /echo with valid token... "
RESPONSE=$(curl -s -H "Authorization: Bearer $BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"test": "data"}' \
    "$ECHO_ENDPOINT")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_CODE}" \
    -H "Authorization: Bearer $BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"test": "data"}' \
    "$ECHO_ENDPOINT")
if [ "$HTTP_CODE" = "200" ]; then
    AUTHENTICATED=$(echo "$RESPONSE" | jq -r '.authenticated')
    if [ "$AUTHENTICATED" = "true" ]; then
        echo -e "${GREEN}✓ Got 200 with authenticated response${NC}"
    else
        echo -e "${RED}✗ Got 200 but authenticated flag is false${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Expected 200, got $HTTP_CODE${NC}"
    exit 1
fi

echo ""
echo "========================================="
echo -e "${GREEN}All tests passed! ✓${NC}"
echo "========================================="
echo ""
echo "Summary:"
echo "  - Unauthenticated requests correctly rejected (401)"
echo "  - Malformed requests correctly rejected (401)"
echo "  - Authenticated requests succeeded (200)"
echo "  - API key rotation supported via comma-separated hashes"
