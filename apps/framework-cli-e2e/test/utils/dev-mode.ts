import { ChildProcess, SpawnOptions, spawn } from "child_process";
import { logger, ScopedLogger } from "./logger";
import { buildPortEnv, TestPorts } from "./port-config";

const devModeLogger = logger.scope("utils:dev-mode");

export type E2eDevMode = "dockerless" | "docker";

const DEFAULT_E2E_DEV_MODE: E2eDevMode = "dockerless";
const E2E_DEV_MODE_ENV_VAR = "MOOSE_E2E_DEV_MODE";

export interface ResolveDevModeOptions {
  logger?: ScopedLogger;
}

export interface BuildMooseDevEnvOptions {
  language?: string;
  projectDir: string;
  portEnv?: NodeJS.ProcessEnv;
  ports?: TestPorts;
  extraEnv?: NodeJS.ProcessEnv;
  preserveHttpPortsFromEnv?: boolean;
}

export interface StartMooseDevOptions extends BuildMooseDevEnvOptions {
  cliPath: string;
  cwd: string;
  mode?: E2eDevMode;
  stdio?: SpawnOptions["stdio"];
  logger?: ScopedLogger;
}

export interface DevCleanupOptions {
  includeDocker?: boolean;
}

export function resolveE2eDevMode(
  options: ResolveDevModeOptions = {},
): E2eDevMode {
  const log = options.logger ?? devModeLogger;
  const rawMode = process.env[E2E_DEV_MODE_ENV_VAR];

  if (rawMode === undefined || rawMode === "") {
    return DEFAULT_E2E_DEV_MODE;
  }

  if (rawMode === "dockerless" || rawMode === "docker") {
    return rawMode;
  }

  log.warn(
    `Invalid ${E2E_DEV_MODE_ENV_VAR} value "${rawMode}", defaulting to ${DEFAULT_E2E_DEV_MODE}`,
  );
  return DEFAULT_E2E_DEV_MODE;
}

export function isDockerlessMode(mode: E2eDevMode): boolean {
  return mode === "dockerless";
}

export function buildMooseDevArgs(mode: E2eDevMode): string[] {
  return isDockerlessMode(mode) ? ["dev", "--dockerless"] : ["dev"];
}

export function buildMooseDevEnv(
  options: BuildMooseDevEnvOptions,
): NodeJS.ProcessEnv {
  const {
    language,
    projectDir,
    portEnv,
    ports,
    extraEnv = {},
    preserveHttpPortsFromEnv = false,
  } = options;
  const resolvedPortEnv = portEnv ?? (ports ? buildPortEnv(ports) : {});
  const effectivePortEnv =
    preserveHttpPortsFromEnv ?
      Object.fromEntries(
        Object.entries(resolvedPortEnv).filter(
          ([key]) =>
            key !== "MOOSE_HTTP_SERVER_CONFIG__PORT" &&
            key !== "MOOSE_HTTP_SERVER_CONFIG__MANAGEMENT_PORT",
        ),
      )
    : resolvedPortEnv;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...effectivePortEnv,
    MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
    MOOSE_FEATURES__WORKFLOWS: "false",
    MOOSE_TELEMETRY__ENABLED: "false",
    MOOSE_ACCEPT_DESTRUCTIVE: "1",
    ...extraEnv,
  };

  if (language === "python") {
    env.VIRTUAL_ENV = `${projectDir}/.venv`;
    env.PATH = `${projectDir}/.venv/bin:${process.env.PATH}`;
  }

  return env;
}

export function getCleanupOptionsForMode(
  mode: E2eDevMode,
  options: DevCleanupOptions = {},
): DevCleanupOptions {
  return {
    includeDocker: options.includeDocker ?? !isDockerlessMode(mode),
  };
}

export function startMooseDev(options: StartMooseDevOptions): {
  mode: E2eDevMode;
  devProcess: ChildProcess;
  env: NodeJS.ProcessEnv;
} {
  const {
    cliPath,
    cwd,
    mode = resolveE2eDevMode({ logger: options.logger }),
    stdio = "pipe",
    ...envOptions
  } = options;

  const env = buildMooseDevEnv(envOptions);
  const devProcess = spawn(cliPath, buildMooseDevArgs(mode), {
    stdio,
    cwd,
    env,
  });

  return { mode, devProcess, env };
}
