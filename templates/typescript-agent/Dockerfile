
# Stage 1: Full monorepo context for dependency resolution
FROM node:20-bookworm-slim AS monorepo-base

# This is to remove the notice to update NPM that will break the output from STDOUT
RUN npm config set update-notifier false

# Install alternative package managers globally
RUN npm install -g pnpm@latest

# Set working directory to monorepo root
WORKDIR /monorepo

# Copy workspace configuration files
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY .npmr[c] ./
COPY pnpm-lock.yaml ./

# Copy workspace package directories (will be replaced with actual patterns)
COPY packages ./packages

# Install all dependencies from monorepo root
RUN pnpm install --frozen-lockfile

# Stage 2: Production image
FROM node:20-bookworm-slim

# This is to remove the notice to update NPM that will break the output from STDOUT
RUN npm config set update-notifier false

# Install alternative package managers globally
RUN npm install -g pnpm@latest

ARG DEBIAN_FRONTEND=noninteractive

# Update the package lists for upgrades for security purposes
RUN apt-get update && apt-get upgrade -y

# Install ca-certificates, tail and locales package
RUN apt-get install -y ca-certificates locales coreutils curl && update-ca-certificates

# moose depends on libc 2.40+, not available in stable
# This uses unstable, but unpinned because they delete older versions
RUN echo "deb http://deb.debian.org/debian/ unstable main" >> /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y libc6 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Generate locale files
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8
ENV TZ=UTC
ENV DOCKER_IMAGE=true

# Install Moose
ARG FRAMEWORK_VERSION="0.0.0"
ARG DOWNLOAD_URL
RUN echo "DOWNLOAD_URL: ${DOWNLOAD_URL}"
RUN ldd --version
RUN curl -Lo /usr/local/bin/moose ${DOWNLOAD_URL}
RUN chmod +x /usr/local/bin/moose

RUN moose --version

# Setup healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:4000/health || exit 1

# Sets up non-root user using 1001 because node creates a user with 1000
RUN groupadd --gid 1001 moose \
  && useradd --uid 1001 --gid moose --shell /bin/bash --create-home moose

# Set the working directory inside the container
WORKDIR /application

# Ensure application directory is owned by moose user
RUN chown -R moose:moose /application

# Placeholder for the language specific copy package file copy

# Copy application files from monorepo stage
COPY --from=monorepo-base --chown=moose:moose /monorepo/packages/moosestack-service/app ./app
COPY --from=monorepo-base --chown=moose:moose /monorepo/packages/moosestack-service/package.json ./package.json
COPY --from=monorepo-base --chown=moose:moose /monorepo/packages/moosestack-service/tsconfig.json ./tsconfig.json

# Use pnpm deploy from workspace context to create clean production dependencies
USER root:root
WORKDIR /temp-monorepo
COPY --from=monorepo-base /monorepo/pnpm-workspace.yaml ./
COPY --from=monorepo-base /monorepo/pnpm-lock.yaml ./
COPY --from=monorepo-base /monorepo/.npmr[c] ./
COPY --from=monorepo-base /monorepo/packages/moosestack-service ./packages/moosestack-service
# Copy all workspace directories that exist
COPY --from=monorepo-base /monorepo/packages ./packages
# Use package manager to install only production dependencies

# Use package manager to install only production dependencies
RUN pnpm --filter "./packages/moosestack-service" deploy /temp-deploy --legacy

# Fix: When using pnpm deploy --legacy, native bindings aren't copied, so rebuild them from source
# Generic solution: Find and rebuild all packages with native bindings (those with binding.gyp)
RUN echo "=== Rebuilding native modules ===" && \
    cd /temp-deploy && \
    found_native=0 && \
    for dir in $(find node_modules -name "binding.gyp" -type f 2>/dev/null | xargs -r dirname); do \
        found_native=1; \
        package_name=$(basename $(dirname "$dir")); \
        echo "Found native module: $package_name in $dir"; \
        if (cd "$dir" && npm rebuild 2>&1); then \
            echo "✓ Successfully rebuilt $package_name"; \
        else \
            echo "⚠ Warning: Failed to rebuild $package_name (may be optional)"; \
        fi; \
    done && \
    if [ $found_native -eq 0 ]; then \
        echo "No native modules found (this is normal if your deps don't have native bindings)"; \
    fi && \
    echo "=== Native modules rebuild complete ==="
RUN cp -r /temp-deploy/node_modules /application/node_modules
RUN chown -R moose:moose /application/node_modules

# No TypeScript path transformations needed
USER root:root
# Clean up temporary directories
RUN rm -rf /temp-deploy /temp-monorepo

RUN if [ -d "/application/node_modules/@514labs/moose-lib/dist/" ]; then ls -la /application/node_modules/@514labs/moose-lib/dist/; fi
USER moose:moose
WORKDIR /application

# https://stackoverflow.com/questions/70096208/dockerfile-copy-folder-if-it-exists-conditional-copy/70096420#70096420
COPY --chown=moose:moose packages/moosestack-service/project.tom[l] ./project.toml
COPY --chown=moose:moose packages/moosestack-service/moose.config.tom[l] ./moose.config.toml
COPY --chown=moose:moose packages/moosestack-service/.moose/packager/versions .moose/versions


# Placeholder for the language specific install command
# Dependencies copied from monorepo build stage

# Placeholder for TypeScript pre-compilation step (empty for Python)
# Run TypeScript type checking
# Run typecheck before we compile since we skip typecheck there
RUN npx moose check

# Pre-compile TypeScript with moose plugins (typia, compilerPlugin)
# This eliminates ts-node overhead at runtime for faster worker startup
RUN MOOSE_SOURCE_DIR='app' npx moose-tspc

# Set environment variable to use pre-compiled JavaScript at runtime
ENV MOOSE_USE_COMPILED=true

# all commands from here on will be run as the moose user
USER moose:moose

# Checks that the project is valid
RUN which moose
RUN moose check --write-infra-map || (echo "Error running moose check" && exit 1)

# Expose the ports on which the application will listen
EXPOSE 4000

# Set the command to run the application
CMD ["moose", "prod"]
