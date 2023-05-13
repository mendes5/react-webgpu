export const lResource = (...args: unknown[]) => {
  if (typeof window !== "undefined") {
    if (localStorage.debug) {
      console.log("backend:resource-manager", ...args);
    }
  }
};
