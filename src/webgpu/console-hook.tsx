import { useEffect, useRef } from "react";

export const useConsoleHook = (
  name: string,
  callback: (() => void) | (() => Promise<void>)
) => {
  const callbakRef = useRef(callback);
  callbakRef.current = callback;

  useEffect(() => {
    Object.assign(window, {
      [name]: () => {
        try {
          const out = callbakRef.current();

          if (out instanceof Promise) {
            out.catch(console.error);
          }
        } catch (error) {
          console.error(error);
        }
      },
    });
  }, [name]);
};
