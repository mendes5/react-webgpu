import {
  useMemo,
  type ForwardedRef,
  type MutableRefObject,
  type RefCallback,
  useState,
  useCallback,
} from "react";
import { useEffect, useRef } from "react";
import { useCounter, useIsMounted } from "usehooks-ts";
import { log } from "~/webgpu/logger";
import { type H } from "./other";

const GLOBAL_VERSION = {
  v: 0,
};

const DEFAULT_ASYNC_STATE = { type: "pending" } as const;

type CompatibleRef<T> = MutableRefObject<T> | RefCallback<T> | ForwardedRef<T>;

export const useCombinedRefs = <T>(...refs: CompatibleRef<T | null>[]) => {
  const targetRef = useRef<T | null>(null);

  useEffect(() => {
    refs.forEach((ref) => {
      if (!ref) return;

      if (typeof ref === "function") {
        ref(targetRef.current);
      } else {
        ref.current = targetRef.current;
      }
    });
  }, [refs]);

  return targetRef;
};

export type V<T> = T & {
  useVersionCacheBurstId: number;
};

const NO_OP = () => undefined;

export const useV = <T extends object>(
  generator: (dispose: (callback: () => void) => void, version: number) => T,
  deps: unknown[]
): [result: V<T>, forceUpdate: () => void] => {
  const { count, increment } = useCounter(0);
  const innerVersion = useRef<number>();
  if (innerVersion.current === null) {
    innerVersion.current = GLOBAL_VERSION.v++;
  }
  const generatorRef = useRef(generator);
  generatorRef.current = generator;

  const disposeRef = useRef<() => void>(NO_OP);

  const result = useMemo(() => {
    disposeRef.current();
    innerVersion.current = GLOBAL_VERSION.v++;

    const result = generatorRef.current((callback) => {
      disposeRef.current = callback;
    }, innerVersion.current);

    if (!Object.isExtensible(result)) {
      throw new Error("Object to be versioned is not extensible");
    }

    Object.assign(result, {
      useVersionCacheBurstId: innerVersion.current,
    });

    return result as V<T>;
  }, [count, ...deps]);

  return [result, increment];
};

export const useAsyncV = <T extends object>(
  generator: (
    dispose: (callback: () => void) => void,
    version: number
  ) => Promise<T>,
  deps: unknown[]
): [AsyncState<V<T>>, () => void] => {
  const { count, increment } = useCounter(0);
  const innerVersion = useRef<number>();
  if (innerVersion.current === null) {
    innerVersion.current = GLOBAL_VERSION.v++;
  }
  const generatorRef = useRef(generator);
  generatorRef.current = generator;

  const [result, setResult] = useState<AsyncState<V<T>>>(DEFAULT_ASYNC_STATE);
  const currentPromise = useRef<null | Promise<void>>(null);
  const disposeRef = useRef<null | (() => void)>(null);

  const isMounted = useIsMounted();

  useEffect(() => {
    // If the promise from the previous render is
    // still active, just register the disposal callback
    // and let it continue
    // TODO: how does this interact with force version?
    if (!currentPromise.current) {
      // Otherwise this is a new render
      const version = (innerVersion.current = GLOBAL_VERSION.v++);

      // Set it to mark that it is pending
      currentPromise.current = generatorRef
        .current((callback) => {
          disposeRef.current = (state?: AsyncState<V<T>>) => {
            callback();

            if (isMounted()) {
              setResult(state ?? DEFAULT_ASYNC_STATE);
            }
          };
        }, version)
        .then((value) => {
          if (isMounted()) {
            if (Object.isExtensible(value)) {
              Object.assign(value, {
                useVersionCacheBurstId: innerVersion.current,
              });
              setResult({ type: "success", value: value as V<T> });
            } else {
              const error = new Error("Object is not extensible");

              setResult({
                type: "error",
                error,
              });

              log("Failed to create versioned object, it was not extensible", {
                error,
              });
            }
          }
        })
        .catch((error: Error) => {
          if (isMounted()) {
            setResult({ type: "error", error });
          }
        })
        .finally(() => {
          // Clear it to mark that if a dispose is required
          // it can run.
          // Or if a next render happens, it can attempt
          // to create the resource.
          currentPromise.current = null;
        });
    }

    return () => {
      if (!currentPromise.current) {
        disposeRef.current?.();
      }
    };
  }, [count, isMounted, ...deps]);

  return [result, increment];
};

export type AsyncState<T> =
  | {
      type: "pending";
    }
  | {
      type: "success";
      value: T;
    }
  | {
      type: "error";
      error: Error;
    };

export const useAsyncResource = <T>(
  generator: (dispose: (callback: () => void) => void) => Promise<T>,
  deps: unknown[]
): AsyncState<T> => {
  const [result, setResult] = useState<AsyncState<T>>(DEFAULT_ASYNC_STATE);

  const isMounted = useIsMounted();

  useEffect(() => {
    const disposerRef = { current: null } as { current: null | (() => void) };
    generator((calllback) => {
      disposerRef.current = () => {
        calllback();
      };
    })
      .then((value) => {
        if (isMounted()) {
          setResult({ type: "success", value });
        }
      })
      .catch((error: Error) => {
        if (isMounted()) {
          setResult({ type: "error", error });
        }
      });

    return () => {
      disposerRef.current?.();
    };
  }, deps);

  return result;
};

type NoUndefinedField<T> = {
  [P in keyof T]-?: NonNullable<T[P]>;
};

export const useMemoBag = <
  T extends Record<string, unknown | null | undefined>,
  R
>(
  bag: T,
  builder: (bag: NoUndefinedField<T>) => R,
  deps: unknown[]
): R | null => {
  return useMemo(() => {
    const hasInvalidValues = Object.values(bag).includes(null);

    if (!hasInvalidValues) {
      // eslint-disable-next-line
      // @ts-ignore
      return builder(bag as NoUndefinedField<T>);
    }

    return null;
  }, [...Object.values(bag), ...deps]);
};

type ActionState<T> =
  | { type: "stale" }
  | {
      type: "executing";
    }
  | {
      type: "success";
      value: T;
    }
  | {
      type: "error";
      error: Error;
    };

const DEFAULT_ACTION_STATE = { type: "stale" } as const;

type AsyncActionResult<R> = {
  isRunning: boolean;
  canRun: boolean;
  locked: boolean;
  state: ActionState<R>;
  execute: () => Promise<R>;
};

export const useAsyncAction = <
  T extends Record<string, unknown | null | undefined>,
  R
>(
  bag: T,
  builder: (bag: NoUndefinedField<T>) => Promise<R>,
  deps: unknown[],
  canRunWhilePending = false
): AsyncActionResult<R> => {
  const builderRef = useRef(builder);
  builderRef.current = builder;

  const [state, setState] = useState<ActionState<R>>(DEFAULT_ACTION_STATE);
  const isMounted = useIsMounted();
  const execute = useCallback(() => {
    setState({ type: "executing" });
    return builderRef
      .current(bag as NoUndefinedField<T>)
      .then((value) => {
        if (isMounted()) {
          setState({ type: "success", value });
        }
        return value;
      })
      .catch((error: Error) => {
        if (isMounted()) {
          setState({ type: "error", error });
        }
        return Promise.reject(error);
      });
  }, [...Object.values(bag), ...deps]);

  return useMemo(() => {
    const isValid = !Object.values(bag).includes(null);

    const canRun = canRunWhilePending
      ? isValid
      : state.type !== "executing" && isValid;

    return {
      execute,
      canRun,
      isRunning: state.type === "executing",
      state,
      locked: !canRun,
    };
  }, [execute, ...Object.values(bag), ...deps]);
};

type ActionResult<R> = {
  canRun: boolean;
  locked: boolean;
  execute: () => R;
};

export const useAction = <
  T extends Record<string, unknown | null | undefined>,
  R
>(
  bag: T,
  builder: (bag: NoUndefinedField<T>) => R,
  deps: unknown[]
): ActionResult<R> => {
  const builderRef = useRef(builder);
  builderRef.current = builder;

  const execute = useCallback(() => {
    return builderRef.current(bag as NoUndefinedField<T>);
  }, [...Object.values(bag), ...deps]);

  return useMemo(() => {
    const isValid = !Object.values(bag).includes(null);

    return {
      execute,
      canRun: isValid,
      locked: !isValid,
    };
  }, [execute, ...Object.values(bag), ...deps]);
};

export const useAsyncH = <T extends object>(
  generator: (
    dispose: (callback: () => void) => void,
    hash: string
  ) => Promise<T>,
  deps: unknown[]
): [AsyncState<H<T>>, () => void] => {
  const { count, increment } = useCounter(0);
  const generatorRef = useRef(generator);
  generatorRef.current = generator;

  const [result, setResult] = useState<AsyncState<H<T>>>(DEFAULT_ASYNC_STATE);
  const currentPromise = useRef<null | Promise<void>>(null);
  const disposeRef = useRef<null | (() => void)>(null);

  const isMounted = useIsMounted();

  useEffect(() => {
    // If the promise from the previous render is
    // still active, just register the disposal callback
    // and let it continue
    // TODO: how does this interact with force version?
    if (!currentPromise.current) {
      const hash = crypto.randomUUID();

      // Set it to mark that it is pending
      currentPromise.current = generatorRef
        .current((callback) => {
          disposeRef.current = (state?: AsyncState<H<T>>) => {
            callback();

            if (isMounted()) {
              setResult(state ?? DEFAULT_ASYNC_STATE);
            }
          };
        }, hash)
        .then((value) => {
          if (isMounted()) {
            if (Object.isExtensible(value)) {
              Object.assign(value, { instanceId: crypto.randomUUID() });
              setResult({ type: "success", value: value as H<T> });
            } else {
              const error = new Error("Object is not extensible");

              setResult({
                type: "error",
                error,
              });

              log("Failed to create versioned object, it was not extensible", {
                error,
              });
            }
          }
        })
        .catch((error: Error) => {
          if (isMounted()) {
            setResult({ type: "error", error });
          }
        })
        .finally(() => {
          // Clear it to mark that if a dispose is required
          // it can run.
          // Or if a next render happens, it can attempt
          // to create the resource.
          currentPromise.current = null;
        });
    }

    return () => {
      if (!currentPromise.current) {
        disposeRef.current?.();
      }
    };
  }, [count, isMounted, ...deps]);

  return [result, increment];
};
