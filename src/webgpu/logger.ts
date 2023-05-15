import debug from "debug";

const d = debug("backend");

export const log = (message: string, ...args: unknown[]) => {
  if (typeof window !== "undefined") {
    if (localStorage.debug) {
      d(message, ...args);
    }
  }
};
