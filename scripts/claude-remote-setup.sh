#!/bin/bash
# Claude Code Remote Environment Setup Script
# This script installs dependencies required for building and developing MooseStack
# in Claude Code remote (web) environments.

set -e

# =============================================================================
# VERSION CONSTANTS
# Update these versions as needed when upgrading dependencies
# These versions are for Ubuntu 24.04 (noble)
# =============================================================================
PYTHON_VERSION_REQUIRED="3.12"
DOCKER_VERSION="5:27.5.1-1~ubuntu.24.04~noble"
DOCKER_COMPOSE_VERSION="2.32.4-1~ubuntu.24.04~noble"
PROTOBUF_COMPILER_VERSION="3.21.12-8.2ubuntu0.2"
LIBRDKAFKA_VERSION="2.3.0-1build2"
LIBCURL_VERSION="8.5.0-2ubuntu10.6"
LIBSASL2_VERSION="2.1.28+dfsg1-5ubuntu3.1"

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
apt-get install -y -qq protobuf-compiler="$PROTOBUF_COMPILER_VERSION" || \
    apt-get install -y -qq protobuf-compiler

# =============================================================================
# KAFKA/LIBRDKAFKA DEPENDENCIES
# =============================================================================
echo "Installing Kafka native library dependencies..."
apt-get install -y -qq \
    librdkafka-dev="$LIBRDKAFKA_VERSION" \
    libcurl4-openssl-dev="$LIBCURL_VERSION" \
    libsasl2-dev="$LIBSASL2_VERSION" || \
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

    # Try to install from deadsnakes PPA (may fail if PPA is blocked)
    if apt-get install -y -qq software-properties-common 2>/dev/null && \
       add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null && \
       apt-get update -qq 2>/dev/null; then
        apt-get install -y -qq \
            python${PYTHON_VERSION_REQUIRED} \
            python${PYTHON_VERSION_REQUIRED}-venv \
            python${PYTHON_VERSION_REQUIRED}-dev 2>/dev/null && \
        update-alternatives --install /usr/bin/python3 python3 /usr/bin/python${PYTHON_VERSION_REQUIRED} 1 2>/dev/null || true
    else
        echo "Warning: Could not install Python $PYTHON_VERSION_REQUIRED (PPA may be blocked)"
        echo "         Python E2E tests may not work. Current version: Python $CURRENT_PYTHON_VERSION"
    fi
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
echo "  - protobuf-compiler: $(dpkg -s protobuf-compiler 2>/dev/null | grep '^Version:' | cut -d' ' -f2 || echo 'installed')"
echo "  - librdkafka-dev: $(dpkg -s librdkafka-dev 2>/dev/null | grep '^Version:' | cut -d' ' -f2 || echo 'installed')"
echo "  - libcurl4-openssl-dev: $(dpkg -s libcurl4-openssl-dev 2>/dev/null | grep '^Version:' | cut -d' ' -f2 || echo 'installed')"
echo "  - libsasl2-dev: $(dpkg -s libsasl2-dev 2>/dev/null | grep '^Version:' | cut -d' ' -f2 || echo 'installed')"
echo "  - Python: $(python3 --version 2>/dev/null || echo 'not verified')"
echo ""
echo "To install Node.js dependencies: pnpm install"
echo "To build Rust CLI: cargo build"
echo "To run E2E tests: cd apps/framework-cli-e2e && pnpm test"
echo ""

exit 0
