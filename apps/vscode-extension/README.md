# Fiveonefour

Fiveonefour is a narrow VS Code workspace extension for keeping the Moose and `514` CLIs installed and current, then pointing you at the next step for creating a Moose Harness project.

## What the extension does

- Runs the Fiveonefour installer on every activation to keep `moose` and `514` current.
- Detects the installed CLI versions and records the latest install state.
- Opens a Harness splash page after the first successful install or update in a session.
- Exposes one manual command: `Fiveonefour: Check Install State`.

## Create a Moose Harness project

When the installer run succeeds, Fiveonefour opens a splash page with the current Harness init command:

```bash
moose init
```

Use that command from a terminal in the parent directory where you want the new project to be created.

## Platform support

- Supported: macOS, Linux, VS Code Remote - WSL
- Unsupported: native Windows

On Windows, Fiveonefour does not attempt to run the installer. It shows a message telling you to reopen the project in WSL instead.

## Check install state

Run `Fiveonefour: Check Install State` from the Command Palette to open the extension output and review:

- the last installer result
- the last attempt / success / failure timestamps
- detected `moose` and `514` versions
- the current Harness init command

## Links

- Docs: https://docs.fiveonefour.com/moosestack
- Support: http://slack.moosestack.com/
