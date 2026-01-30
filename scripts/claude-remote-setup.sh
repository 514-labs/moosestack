#!/bin/bash
# Claude Code Remote Environment Setup Script
# This script installs dependencies required for building and developing MooseStack
# in Claude Code remote (web) environments.

set -e

# =============================================================================
# VERSION CONSTANTS
# Update these versions as needed when upgrading dependencies
# =============================================================================
PYTHON_VERSION_REQUIRED="3.12"
DOCKER_VERSION="5:27.5.1-1~ubuntu.24.04~noble"
DOCKER_COMPOSE_VERSION="2.32.4-1~ubuntu.24.04~noble"

# =============================================================================
# ENVIRONMENT CHECK
# =============================================================================

# Only run in remote environments
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
    echo "Not running in Claude Code remote environment, skipping setup."
    exit 0
fi

echo "=========================================="
echo "MooseStack Claude Code Environment Setup"
echo "=========================================="

# Check if we have apt-get available
if ! command -v apt-get &> /dev/null; then
    echo "apt-get not found, skipping system package installation"
    exit 0
fi

echo ""
echo "Installing system dependencies..."
echo "------------------------------------------"

# =============================================================================
# DOCKER INSTALLATION
# =============================================================================
echo "Installing Docker..."

# Install Docker prerequisites
apt-get update -qq
apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq

# Install Docker packages
apt-get install -y -qq \
    docker-ce="$DOCKER_VERSION" \
    docker-ce-cli="$DOCKER_VERSION" \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin="$DOCKER_COMPOSE_VERSION" || {
    echo "Warning: Could not install specific Docker versions, trying latest..."
    apt-get install -y -qq \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin || echo "Warning: Docker installation failed (may not be supported in this environment)"
}

# Start Docker daemon if possible
service docker start 2>/dev/null || echo "Warning: Could not start Docker daemon (may require privileged container)"

# =============================================================================
# PROTOBUF COMPILER
# =============================================================================
echo "Installing protobuf-compiler..."
apt-get install -y -qq protobuf-compiler

# =============================================================================
# KAFKA/LIBRDKAFKA DEPENDENCIES
# =============================================================================
echo "Installing Kafka native library dependencies..."
apt-get install -y -qq \
    librdkafka-dev \
    libcurl4-openssl-dev \
    libsasl2-dev

# =============================================================================
# PYTHON 3.12+
# =============================================================================
CURRENT_PYTHON_VERSION=$(python3 --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1)

if [ "$(printf '%s\n' "$PYTHON_VERSION_REQUIRED" "$CURRENT_PYTHON_VERSION" | sort -V | head -n1)" != "$PYTHON_VERSION_REQUIRED" ]; then
    echo "Installing Python $PYTHON_VERSION_REQUIRED..."
    apt-get install -y -qq software-properties-common
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -qq
    apt-get install -y -qq \
        python${PYTHON_VERSION_REQUIRED} \
        python${PYTHON_VERSION_REQUIRED}-venv \
        python${PYTHON_VERSION_REQUIRED}-dev

    # Set up alternatives to use Python 3.12 by default
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python${PYTHON_VERSION_REQUIRED} 1 2>/dev/null || true
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "=========================================="
echo "System dependencies installed successfully"
echo "=========================================="
echo ""
echo "Installed packages:"
echo "  - Docker: $(docker --version 2>/dev/null || echo 'not available')"
echo "  - Docker Compose: $(docker compose version 2>/dev/null || echo 'not available')"
echo "  - protobuf-compiler (protoc): $(protoc --version 2>/dev/null || echo 'installed')"
echo "  - librdkafka-dev"
echo "  - libcurl4-openssl-dev"
echo "  - libsasl2-dev"
echo "  - Python: $(python3 --version 2>/dev/null || echo 'not verified')"
echo ""
echo "To install Node.js dependencies: pnpm install"
echo "To build Rust CLI: cargo build"
echo "To run E2E tests: cd apps/framework-cli-e2e && pnpm test"
echo ""

exit 0
