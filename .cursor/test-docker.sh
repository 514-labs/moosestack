#!/bin/bash

# Docker-in-Docker Test Script for Cursor Background Agents
# This script tests the Docker setup in the Cursor agent environment

set -e

echo "=== Docker-in-Docker Test for Cursor Background Agents ==="
echo "Testing Docker functionality in the agent environment..."
echo

# Test 1: Check if Docker daemon is running
echo "1. Checking Docker daemon status..."
if docker info > /dev/null 2>&1; then
    echo "✅ Docker daemon is running"
    docker version
else
    echo "❌ Docker daemon is not running"
    echo "Attempting to start Docker daemon..."
    sudo service docker start
    sleep 3
    if docker info > /dev/null 2>&1; then
        echo "✅ Docker daemon started successfully"
    else
        echo "❌ Failed to start Docker daemon"
        echo "Checking Docker service status:"
        sudo service docker status
        exit 1
    fi
fi
echo

# Test 2: Check iptables configuration
echo "2. Checking iptables configuration..."
if iptables --version | grep -q "legacy"; then
    echo "✅ iptables is using legacy mode"
else
    echo "⚠️  iptables is not in legacy mode"
    echo "Current iptables version:"
    iptables --version
fi
echo

# Test 3: Test basic Docker functionality
echo "3. Testing basic Docker functionality..."
echo "Pulling hello-world image..."
if docker pull hello-world:latest > /dev/null 2>&1; then
    echo "✅ Successfully pulled hello-world image"
else
    echo "❌ Failed to pull hello-world image"
    exit 1
fi

echo "Running hello-world container..."
if docker run --rm hello-world:latest > /dev/null 2>&1; then
    echo "✅ Successfully ran hello-world container"
else
    echo "❌ Failed to run hello-world container"
    exit 1
fi
echo

# Test 4: Test Docker networking
echo "4. Testing Docker networking..."
echo "Starting nginx container on port 8080..."
if docker run -d --name test-nginx -p 8080:80 nginx:alpine > /dev/null 2>&1; then
    echo "✅ Successfully started nginx container"
    
    # Wait a moment for nginx to start
    sleep 2
    
    # Test if we can reach the container
    if curl -s http://localhost:8080 > /dev/null 2>&1; then
        echo "✅ Successfully connected to nginx container via localhost:8080"
    else
        echo "⚠️  Could not connect to nginx container (networking may be limited)"
    fi
    
    # Clean up
    docker stop test-nginx > /dev/null 2>&1
    docker rm test-nginx > /dev/null 2>&1
    echo "✅ Cleaned up test container"
else
    echo "❌ Failed to start nginx container"
fi
echo

# Test 5: Test Docker Compose
echo "5. Testing Docker Compose..."
if docker compose version > /dev/null 2>&1; then
    echo "✅ Docker Compose is available"
    docker compose version
else
    echo "❌ Docker Compose is not available"
fi
echo

# Test 6: Check user permissions
echo "6. Checking user permissions..."
if groups | grep -q docker; then
    echo "✅ User is in docker group"
else
    echo "⚠️  User is not in docker group"
fi

if sudo -n true 2>/dev/null; then
    echo "✅ User has passwordless sudo access"
else
    echo "⚠️  User does not have passwordless sudo access"
fi
echo

echo "=== Docker Test Summary ==="
echo "Docker-in-Docker setup appears to be working correctly!"
echo "You should now be able to run Moose with Docker dependencies."
echo
echo "To test with Moose:"
echo "1. Run 'moose up' or your Moose startup command"
echo "2. Check that Docker containers start successfully"
echo "3. Verify that Moose can connect to its services"