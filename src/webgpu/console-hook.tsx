import { useCallback, useEffect, useRef } from "react";

export const useConsoleHook = <T,>(name: string, callback: () => T) => {
  const callbakRef = useRef(callback);
  callbakRef.current = callback;

  const exec = useCallback(() => {
    try {
      const out = callbakRef.current();

      if (out instanceof Promise) {
        out.catch(console.error);
      }

      return out;
    } catch (error) {
      console.error(error);
      return Promise.reject();
    }
  }, []);

  useEffect(() => {
    Object.assign(window, {
      [name]: exec,
    });
  }, [name, exec]);

  return exec;
};
