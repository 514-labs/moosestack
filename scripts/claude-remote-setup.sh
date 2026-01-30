#!/bin/bash
# Claude Code Remote Environment Setup Script
# This script installs dependencies required for building and developing MooseStack
# in Claude Code remote (web) environments.

set -e

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

# Install protobuf compiler (required for Rust build)
echo "Installing protobuf-compiler..."
apt-get update -qq
apt-get install -y -qq protobuf-compiler

# Install Kafka/librdkafka dependencies (required for @514labs/kafka-javascript native module)
echo "Installing Kafka native library dependencies..."
apt-get install -y -qq \
    librdkafka-dev \
    libcurl4-openssl-dev \
    libsasl2-dev

# Install Python 3.12 if not available (required for moose-cli pip package)
# Note: deadsnakes PPA provides newer Python versions for Ubuntu
PYTHON_VERSION=$(python3 --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1)
REQUIRED_PYTHON="3.12"

if [ "$(printf '%s\n' "$REQUIRED_PYTHON" "$PYTHON_VERSION" | sort -V | head -n1)" != "$REQUIRED_PYTHON" ]; then
    echo "Installing Python 3.12..."
    apt-get install -y -qq software-properties-common
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -qq
    apt-get install -y -qq python3.12 python3.12-venv python3.12-dev

    # Set up alternatives to use Python 3.12 by default
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo "System dependencies installed successfully"
echo "=========================================="
echo ""
echo "Installed packages:"
echo "  - protobuf-compiler (protoc): $(protoc --version 2>/dev/null || echo 'installed')"
echo "  - librdkafka-dev"
echo "  - libcurl4-openssl-dev"
echo "  - libsasl2-dev"
echo "  - Python: $(python3 --version 2>/dev/null || echo 'not verified')"
echo ""
echo "NOTE: Docker is not available in Claude Code remote environments."
echo "      E2E tests requiring Docker must be run in CI or locally."
echo ""
echo "To install Node.js dependencies: pnpm install"
echo "To build Rust CLI: cargo build"
echo ""

exit 0
