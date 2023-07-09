export type Brand<T, B> = T & { __brand: B };

export type CallSite = Brand<string, "CallSite">;

export const getStackFrame = (depth: number): CallSite => {
  const error = new Error();
  if (!error.stack) {
    throw new Error(
      "This runtime does not support the stack property for Error objects"
    );
  }
  const lines = error.stack.split("\n");
  const lineAtDepth = lines[depth]!.trim();
  const lastPathPart = lineAtDepth.split("/").slice(-1)[0];

  return lastPathPart as CallSite;
};

type InnerLock<T> = {
  current: null | Promise<T>;
};

export const createLock = <T = void>(): ((
  promise: () => Promise<T>
) => Promise<T>) => {
  const lock: InnerLock<T> = {
    current: null,
  };

  return async (promise) => {
    if (lock.current) {
      return await lock.current;
    }

    lock.current = promise();

    return lock.current.finally(() => {
      lock.current = null;
    });
  };
};

export const isSameDependencies = (prev: unknown[], next: unknown[]) => {
  let valid = true;
  if (next === undefined && prev === undefined) return true;
  if (prev === undefined) valid = false;
  if (next != null && prev != null) {
    if (next === prev) return true;

    const n = prev.length || 0;
    if (n !== next.length || 0) valid = false;
    else
      for (let i = 0; i < n; ++i)
        if (prev[i] !== next[i]) {
          valid = false;
          break;
        }
  }
  return valid;
};
