import {
  useMemo,
  type ForwardedRef,
  type MutableRefObject,
  type RefCallback,
} from "react";
import { useEffect, useRef } from "react";
import stringHash from "string-hash";
import { useCounter } from "usehooks-ts";

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

export const useEffectInvalidator = () => {
  const { count, increment } = useCounter(0);

  return [count, increment] as const;
};

export type Versioned<T> = {
  version: number;
  value: T;
};

export const useVersion = <T>(
  generator: () => T,
  version = 0
): Versioned<T> => {
  // eslint-disable-next-line
  return useMemo(() => ({ value: generator(), version }), [version]);
};

const CACHE = new Map<number, unknown>();

export const useHashedCache = <T>(
  prefix: string,
  generator: () => T,
  deps: unknown[],
  hashes: (string | number | boolean | null | undefined)[]
): T => {
  return useMemo(() => {
    const key = [prefix, ...hashes].join(",");
    const hash = stringHash(key);

    if (CACHE.has(hash)) {
      return CACHE.get(hash) as T;
    } else {
      const value = generator();
      CACHE.set(hash, value);
      return value;
    }
    // eslint-disable-next-line
  }, [prefix, ...deps, ...hashes]);
};
