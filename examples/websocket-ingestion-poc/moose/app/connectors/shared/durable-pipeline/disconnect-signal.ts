export interface DisconnectSignal {
  promise: Promise<unknown>;
  resolve: (error?: unknown) => void;
}

export function createDisconnectSignal(): DisconnectSignal {
  let resolved = false;
  let resolvePromise!: (error?: unknown) => void;

  const promise = new Promise<unknown>((resolve) => {
    resolvePromise = (error?: unknown) => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(error);
    };
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}
