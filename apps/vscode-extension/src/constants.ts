export const EXTENSION_BRAND = "Fiveonefour";
export const OUTPUT_CHANNEL_NAME = EXTENSION_BRAND;
export const INSTALL_STATE_KEY = "fiveonefour.installState";

export const COMMANDS = {
  checkInstallState: "fiveonefour.checkInstallState",
} as const;

export const INSTALLER_SCRIPT_URL = "https://fiveonefour.com/install.sh";
export const INSTALLER_TARGETS = ["moose", "514"] as const;
export const HARNESS_INIT_COMMAND = "moose harness init";

export const MOOSESTACK_DOCS_URL =
  "https://docs.fiveonefour.com/moosestack?utm_source=vscode-extension";
export const SUPPORT_URL = "http://slack.moosestack.com/";

export const WINDOWS_WSL_MESSAGE =
  "Fiveonefour installs the Moose and 514 CLIs on macOS, Linux, and VS Code Remote - WSL. On Windows, open the project in WSL and run the extension there.";
