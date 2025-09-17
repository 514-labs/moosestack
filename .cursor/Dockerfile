FROM ubuntu:24.04

# Set non-interactive mode to prevent prompts
ENV DEBIAN_FRONTEND=noninteractive

# Set timezone early to prevent clock skew issues
ENV TZ=UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Work around potential clock skew in build environment for apt
RUN printf 'Acquire::Check-Valid-Until "false";\nAcquire::Check-Date "false";\n' > /etc/apt/apt.conf.d/99no-check-valid-until

# Install system dependencies (protobuf-compiler will be installed separately with specific version)
# Use apt options to handle potential clock skew issues
RUN apt-get update -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libsqlite3-dev \
    libpq-dev \
    unzip \
    zip \
    ca-certificates \
    gnupg \
    lsb-release \
    python3-dev \
    python3-pip \
    python3-venv \
    apt-transport-https \
    software-properties-common \
    sudo \
    iptables \
    && rm -rf /var/lib/apt/lists/*

# Add Docker's official GPG key and repository
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list

# Install Docker Engine (docker-ce), CLI, Containerd, and Docker Compose plugin
RUN apt-get update -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false && apt-get install -y --no-install-recommends \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install pnpm
RUN npm install -g pnpm@9.9.0

# Install Python 3.12 (Ubuntu 24.04 comes with Python 3.12 by default)
RUN apt-get update -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false \
    && apt-get install -y python3 python3-dev python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install additional Python packages needed for development
RUN python3 -m pip install --break-system-packages virtualenv setuptools wheel maturin==1.8.1

# Install Protocol Buffers compiler (version 24.4 to match CI)
RUN PROTOC_VERSION=24.4 \
    && PROTOC_ZIP=protoc-$PROTOC_VERSION-linux-x86_64.zip \
    && curl -OL https://github.com/protocolbuffers/protobuf/releases/download/v$PROTOC_VERSION/$PROTOC_ZIP \
    && unzip -o $PROTOC_ZIP -d /usr/local bin/protoc \
    && unzip -o $PROTOC_ZIP -d /usr/local 'include/*' \
    && rm -f $PROTOC_ZIP \
    && chmod +x /usr/local/bin/protoc

# Install Rust toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Set up PATH environment variables for consistent access in all contexts
ENV PATH="/root/.cargo/bin:${PATH}"

# Create docker group and add the default 'ubuntu' user to both docker and sudo groups
RUN groupadd -f docker && \
    usermod -aG docker,sudo ubuntu && \
    echo "ubuntu ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Switch iptables to legacy mode for Docker compatibility
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy && \
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

# Verify installations
RUN node --version \
    && npm --version \
    && pnpm --version \
    && python3 --version \
    && pip --version \
    && protoc --version \
    && maturin --version \
    && rustc --version \
    && cargo --version \
    && docker --version

# Set working directory
WORKDIR /workspace

# Switch to ubuntu user for the running environment
USER ubuntu

# Declare Docker data volume
VOLUME /var/lib/docker

# Copy and run verification script
COPY scripts/verify-environment.sh /tmp/verify-environment.sh
RUN chmod +x /tmp/verify-environment.sh \
    && /tmp/verify-environment.sh