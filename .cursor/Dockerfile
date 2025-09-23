# Base image
FROM ubuntu:24.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV TERM=xterm-256color
ENV PROTOC_VERSION=28.3
ENV NVM_VERSION=v0.40.1
ENV NODE_VERSION=22
ENV PNPM_VERSION=9.15.2

# Update and install basic dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    unzip \
    iptables \
    python3.12 \
    python3.12-venv \
    python3.12-dev \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Switch to iptables-legacy
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy && \
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

# Install Docker using the convenience script
RUN curl -fsSL https://get.docker.com -o get-docker.sh && \
    sh get-docker.sh && \
    rm get-docker.sh

# Install Protocol Buffers
RUN PROTOC_ZIP=protoc-${PROTOC_VERSION}-linux-x86_64.zip && \
    curl -LO https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/${PROTOC_ZIP} && \
    unzip -o ${PROTOC_ZIP} -d /usr/local bin/protoc && \
    unzip -o ${PROTOC_ZIP} -d /usr/local 'include/*' && \
    rm -f ${PROTOC_ZIP} && \
    chmod +x /usr/local/bin/protoc

# Create non-root user with sudo privileges
RUN useradd -m -s /bin/bash developer && \
    echo 'developer ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    usermod -aG docker developer

RUN echo '#!/bin/bash' > /usr/local/bin/docker-entrypoint.sh && \
    echo '# Fix Docker socket permissions if mounted from host' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'if [ -S /var/run/docker.sock ]; then' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    sudo chmod 666 /var/run/docker.sock' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'else' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    # Start Docker daemon if no socket exists' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    echo "Starting Docker daemon..."' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    sudo dockerd &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    sleep 5' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'exec "$@"' >> /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user for remaining installations
USER developer
WORKDIR /home/developer
ENV HOME=/home/developer

# Install Rust for the non-root user
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/developer/.cargo/bin:${PATH}"

# Install NVM, Node.js 22, and pnpm
SHELL ["/bin/bash", "-c"]
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash && \
    source ~/.nvm/nvm.sh && \
    nvm install ${NODE_VERSION} && \
    nvm alias default ${NODE_VERSION} && \
    nvm use default && \
    npm install -g pnpm@${PNPM_VERSION}

# Setup shell initialization for nvm and docker group
RUN echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc && \
    echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc && \
    echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc && \
    echo '' >> ~/.bashrc && \
    echo '# Ensure docker group is active' >> ~/.bashrc && \
    echo 'if groups | grep -q docker; then' >> ~/.bashrc && \
    echo '    # Docker group is already active' >> ~/.bashrc && \
    echo '    :' >> ~/.bashrc && \
    echo 'else' >> ~/.bashrc && \
    echo '    # If docker group exists but is not active, activate it' >> ~/.bashrc && \
    echo '    if getent group docker > /dev/null 2>&1; then' >> ~/.bashrc && \
    echo '        exec newgrp docker' >> ~/.bashrc && \
    echo '    fi' >> ~/.bashrc && \
    echo 'fi' >> ~/.bashrc

WORKDIR /home/developer

# Set up the entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/bin/bash"]
