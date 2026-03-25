import path from "node:path";

export function getAutomaticBootstrapConsentStateKey(
  workspaceRoot: string,
): string {
  return `moosestack.autoBootstrapConsent:${path.resolve(workspaceRoot)}`;
}

export async function withRecordedAutomaticBootstrapConsent<T>(
  workspaceRoot: string | null,
  recordConsent: (stateKey: string, approved: boolean) => Promise<void>,
  run: () => Promise<T>,
): Promise<T> {
  if (workspaceRoot) {
    await recordConsent(
      getAutomaticBootstrapConsentStateKey(workspaceRoot),
      true,
    );
  }

  return run();
}
