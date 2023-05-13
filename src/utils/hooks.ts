import type { ForwardedRef, MutableRefObject, RefCallback } from "react";
import { useEffect, useRef } from "react";

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
