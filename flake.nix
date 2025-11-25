{
  description = "MooseStack - Multi-language monorepo for building data infrastructure";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    safe-chain-nix = {
      url = "github:LucioFranco/safe-chain-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem =
        {
          config,
          self',
          inputs',
          system,
          lib,
          ...
        }:
        let
          # Apply rust overlay
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ (import inputs.rust-overlay) ];
          };

          # Safe-chain wrapper for malware protection
          safeChain = inputs.safe-chain-nix.lib.${system}.safeChain;

          # Rust toolchain
          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [
              "rust-src"
              "clippy"
              "rustfmt"
            ];
          };

          # Node.js with PNPM (wrapped with safe-chain for malware protection)
          nodejs = safeChain.wrapNode pkgs.nodejs_20;
          pnpm = pkgs.pnpm;

          # Python with required packages (wrapped with safe-chain for malware protection)
          python = pkgs.python312;
          pythonEnv = (python.withPackages (
            ps: with ps; [
              pip
              setuptools
              wheel
            ]
          ));
          wrappedPython = safeChain.wrapPython pythonEnv;

          # Common build inputs
          commonBuildInputs =
            with pkgs;
            [
              pkg-config
              openssl
              protobuf
              # For rdkafka
              rdkafka
              cyrus_sasl
              zlib
              zstd
              lz4
            ]
            ++ lib.optionals pkgs.stdenv.isDarwin [
              pkgs.apple-sdk
              pkgs.libiconv
            ];

          # Helper to convert aliases to scripts
          aliasToScript =
            alias:
            let
              pwd = if alias ? pwd then "$WORKSPACE_ROOT/${alias.pwd}" else "$WORKSPACE_ROOT";
            in
            ''
              set -e
              cd "${pwd}"
              ${alias.cmd}
            '';

          # Define test command aliases
          testAliases = {
            cargo-test = {
              cmd = "cargo test";
            };
            ts-test = {
              pwd = "packages/ts-moose-lib";
              cmd = "pnpm test";
            };
            py-test = {
              pwd = "packages/py-moose-lib";
              cmd = "pytest";
            };
            e2e-test = {
              pwd = "apps/framework-cli-e2e";
              cmd = "pnpm test";
            };
            test-all = {
              cmd = ''
                cargo test && \
                (cd packages/ts-moose-lib && pnpm test) && \
                (cd packages/py-moose-lib && pytest)
              '';
            };
          };

          # Generate scripts for all aliases
          testScripts = pkgs.runCommand "test-scripts" { } ''
            mkdir -p $out/bin
            ${lib.concatStringsSep "\n" (
              lib.mapAttrsToList (name: alias: ''
                cat > $out/bin/${name} << 'EOF'
                #!/usr/bin/env bash
                export WORKSPACE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
                ${aliasToScript alias}
                EOF
                chmod +x $out/bin/${name}
              '') testAliases
            )}
          '';
        in
        {
          # Development Shell
          devShells.default = pkgs.mkShell {
            name = "moose";

            buildInputs = [
              # Languages (with safe-chain malware protection)
              rustToolchain
              nodejs
              pnpm
              wrappedPython

              # Development tools
              pkgs.git
              pkgs.turbo
              pkgs.protobuf
              pkgs.maturin

              # Test scripts
              testScripts

              # Build dependencies
            ]
            ++ commonBuildInputs;

            shellHook = ''
              # Set up PNPM
              export PNPM_HOME="$HOME/.local/share/pnpm"
              export PATH="$PNPM_HOME:$PATH"

              # Set Python path for development
              export PYTHONPATH="$PWD/packages/py-moose-lib:$PYTHONPATH"
            '';
          };

          # Package outputs
          packages = {
            # Template packages - package templates from templates/ directory
            template-packages = pkgs.stdenv.mkDerivation {
              pname = "moose-template-packages";
              version = "0.0.1";

              src = ./templates;

              nativeBuildInputs = [ pkgs.gnutar pkgs.gzip ];

              buildPhase = ''
                # Create manifest header
                cat > manifest.toml << 'EOF'
                [templates]
                EOF

                # Package each template directory
                for template_dir in */; do
                  template_name="''${template_dir%/}"

                  # Create tarball
                  tar -czf "$template_name.tgz" \
                    --exclude="node_modules" \
                    -C "$template_dir" .

                  # Add to manifest if template.config.toml exists
                  if [ -f "$template_dir/template.config.toml" ]; then
                    echo "" >> manifest.toml
                    echo "[templates.$template_name]" >> manifest.toml
                    cat "$template_dir/template.config.toml" >> manifest.toml
                  fi
                done
              '';

              installPhase = ''
                mkdir -p $out
                cp *.tgz manifest.toml $out/
              '';
            };

            # Rust CLI
            moose-cli = pkgs.rustPlatform.buildRustPackage {
              pname = "moose-cli";
              version = "0.0.1";

              src = ./.;

              cargoLock = {
                lockFile = ./Cargo.lock;
                outputHashes = {
                  "opentelemetry-prometheus-0.17.0" = "sha256-KjPqfxnXoxVKZ63nL8v7yKr7KN6z0ZoChuTZpjVV0cI=";
                  "rustfsm-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                  "rustfsm_procmacro-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                  "rustfsm_trait-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                  "temporal-client-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                  "temporal-sdk-core-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                  "temporal-sdk-core-api-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                  "temporal-sdk-core-protos-0.1.0" = "sha256-XkSRoJkMLQJyhOiAAREf3sM+Jqje4z0lxE07LA3nQQo=";
                };
              };

              nativeBuildInputs = [
                pkgs.pkg-config
                pythonEnv
                pkgs.maturin
                pkgs.perl
                # For rdkafka-sys build
                pkgs.bash
                pkgs.gnumake
                pkgs.cmake
                pkgs.coreutils
              ];

              buildInputs = commonBuildInputs;

              # Build only the CLI package
              cargoBuildFlags = [
                "-p"
                "moose-cli"
              ];

              # Skip tests - some tests require filesystem access and external commands
              # that aren't available in the Nix sandbox
              doCheck = false;

              # The build.rs uses protobuf codegen which is pure Rust
              # No need for protoc at build time
              PROTOC = "${pkgs.protobuf}/bin/protoc";

              # Force rdkafka-sys to use pkg-config and system library
              RDKAFKA_SYS_USE_PKG_CONFIG = "1";

              # Patch Cargo.toml to enable dynamic linking for rdkafka
              postPatch = ''
                # Add dynamic-linking feature to rdkafka dependency
                sed -i 's/rdkafka = { version = "0.38", features = \["ssl"\] }/rdkafka = { version = "0.38", features = ["ssl", "dynamic-linking"] }/' apps/framework-cli/Cargo.toml
              '';

              # Ensure bash is available for configure scripts
              preBuild = ''
                export PATH="${pkgs.bash}/bin:${pkgs.coreutils}/bin:$PATH"
                export SHELL="${pkgs.bash}/bin/bash"
              '';

              # Restructure output to match expected template path
              # Real binary at: $out/libexec/moose/moose-cli (3 levels deep)
              # Templates at: $out/template-packages/
              # From binary: parent()/parent()/parent()/join("template-packages") = $out/template-packages ✓
              postInstall = ''
                # Create nested directory for real binary (3 levels deep from $out)
                mkdir -p $out/libexec/moose
                mkdir -p $out/template-packages

                # Move binary to nested location
                mv $out/bin/moose-cli $out/libexec/moose/moose-cli

                # Copy templates from the template-packages derivation
                cp -r ${self'.packages.template-packages}/* $out/template-packages/

                # Create wrapper script in standard bin location
                mkdir -p $out/bin
                cat > $out/bin/moose-cli << 'EOF'
              #!/usr/bin/env bash
              exec "$out/libexec/moose/moose-cli" "$@"
              EOF
                chmod +x $out/bin/moose-cli

                # Substitute $out with actual path
                substituteInPlace $out/bin/moose-cli --replace-fail '$out' "$out"
              '';

              meta = with lib; {
                description = "MooseStack CLI - Build tool for Moose apps";
                homepage = "https://www.fiveonefour.com/moose";
                license = licenses.mit;
                maintainers = [ ];
              };
            };

            # TypeScript packages (built via PNPM)
            ts-moose-lib = pkgs.stdenv.mkDerivation {
              pname = "ts-moose-lib";
              version = "0.0.1";

              src = ./.;

              nativeBuildInputs = [
                nodejs
                pnpm
              ];

              buildPhase = ''
                export HOME=$TMPDIR
                export PNPM_HOME="$HOME/.pnpm"

                # Install dependencies
                pnpm install --frozen-lockfile

                # Build TypeScript packages
                pnpm build --filter=@514labs/moose-lib
              '';

              installPhase = ''
                mkdir -p $out
                cp -r packages/ts-moose-lib/dist $out/
                cp packages/ts-moose-lib/package.json $out/
              '';

              meta = with lib; {
                description = "TypeScript library for MooseStack";
                homepage = "https://www.fiveonefour.com/moose";
                license = licenses.mit;
              };
            };

            # Python library
            py-moose-lib = pythonEnv.pkgs.buildPythonPackage {
              pname = "moose-lib";
              version = "0.0.1";

              src = ./packages/py-moose-lib;

              format = "setuptools";

              propagatedBuildInputs = with pythonEnv.pkgs; [
                pyjwt
                pydantic
                temporalio
                kafka-python-ng
                redis
                humanfriendly
                clickhouse-connect
                requests
              ];

              # Some dependencies might not be in nixpkgs
              doCheck = false;

              meta = with lib; {
                description = "Python library for MooseStack";
                homepage = "https://www.fiveonefour.com/moose";
                license = licenses.mit;
              };
            };

            # Default package
            default = self'.packages.moose-cli;
          };

          # Apps for easy running
          apps = {
            moose = {
              type = "app";
              program = "${self'.packages.moose-cli}/bin/moose-cli";
            };
            default = self'.apps.moose;
          };
        };
    };
}
