# Docker-in-Docker Setup for Cursor Background Agents

This document describes the Docker-in-Docker (DinD) configuration for running Moose in Cursor's background agent environments.

## Overview

Moose requires Docker to run its services (ClickHouse, Redis, etc.) via Docker Compose. Cursor's background agents don't have Docker running by default, which prevents Moose from functioning. This setup enables Docker within the agent environment.

## Configuration Files

### `.cursor/Dockerfile`
The custom Dockerfile that builds the agent environment with Docker support:

- **Base Image**: Ubuntu 24.04 LTS
- **Docker Installation**: Docker Engine, CLI, Containerd, and Docker Compose plugin
- **User Permissions**: `ubuntu` user added to `docker` group with passwordless sudo
- **iptables Configuration**: Switched to legacy mode for Docker compatibility
- **Volume**: `/var/lib/docker` declared for Docker data persistence

### `.cursor/environment.json`
The Cursor environment configuration:

```json
{
  "build": {
    "context": "..",
    "dockerfile": ".cursor/Dockerfile"
  },
  "start": "sudo service docker start && sleep 2 && docker info > /dev/null 2>&1 && echo 'Docker started successfully' || echo 'Docker startup may have issues'",
  "install": "echo 'Installing Moose dependencies...' && pnpm install"
}
```

## Key Features

### 1. Docker Engine Installation
- Installs Docker CE from official Docker repository
- Includes Docker Compose plugin for `docker compose` commands
- Configures proper GPG keys and repository sources

### 2. User Permissions
- Creates `docker` group and adds `ubuntu` user
- Grants passwordless sudo access to `ubuntu` user
- Enables Docker commands without root privileges

### 3. iptables Legacy Mode
- Switches from nftables to legacy iptables
- Resolves Docker networking issues in containerized environments
- Ensures Docker can manage firewall rules properly

### 4. Automatic Docker Startup
- Docker daemon starts automatically when agent launches
- Includes verification to confirm Docker is running
- Provides feedback on startup success/failure

## Testing the Setup

Run the test script to verify Docker functionality:

```bash
./.cursor/test-docker.sh
```

This script tests:
- Docker daemon status
- iptables configuration
- Basic Docker functionality (pull, run containers)
- Docker networking (port mapping)
- Docker Compose availability
- User permissions

## Usage with Moose

Once the environment is configured:

1. **Start a Background Agent**: Use Cursor's background agent feature
2. **Verify Docker**: Run `docker info` to confirm Docker is running
3. **Run Moose**: Execute your Moose commands (e.g., `moose up`)
4. **Check Services**: Use `docker ps` to see running containers

## Troubleshooting

### Docker Daemon Won't Start
- Check if iptables is in legacy mode: `iptables --version`
- Verify user permissions: `groups` should include `docker`
- Check sudo access: `sudo -n true` should succeed

### Networking Issues
- Test with: `docker run -p 8080:80 nginx:alpine`
- Check if containers can reach each other
- Verify port mapping works with `curl localhost:8080`

### Permission Errors
- Ensure user is in docker group: `sudo usermod -aG docker ubuntu`
- Check sudoers configuration: `sudo cat /etc/sudoers | grep ubuntu`

## Limitations

- **Performance**: Docker-in-Docker adds overhead due to nested virtualization
- **Networking**: Some advanced networking features may be limited
- **Storage**: Docker data may be ephemeral depending on Cursor's snapshot behavior
- **Security**: This setup prioritizes functionality over strict isolation

## Fallback Options

If standard Docker networking fails, you can try:

1. **Disable iptables**: Start Docker with `--iptables=false`
2. **Host networking**: Use `--network=host` for containers
3. **No networking**: Use `--network=none` for isolated containers

## Maintenance

- **Updates**: Docker version is pinned to the latest stable
- **Dependencies**: All packages are installed in the Dockerfile
- **Configuration**: Environment settings are in `.cursor/environment.json`

## Support

For issues with this setup:
1. Check the test script output
2. Review Cursor's background agent documentation
3. Consult Docker-in-Docker troubleshooting guides
4. Contact the development team

## References

- [Cursor Background Agents Documentation](https://cursor.sh/docs)
- [Docker-in-Docker Best Practices](https://docs.docker.com/engine/security/rootless/)
- [iptables Legacy Mode](https://wiki.nftables.org/wiki-nftables/index.php/Moving_from_iptables_to_nftables)