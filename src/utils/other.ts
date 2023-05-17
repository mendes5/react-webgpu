export const rand = (min?: number, max?: number) => {
  if (min === undefined) {
    min = 0;
    max = 1;
  } else if (max === undefined) {
    max = min;
    min = 0;
  }
  return min + Math.random() * (max - min);
};

export const range = (end: number): number[] =>
  new Array(end).fill(0).map((_, i) => i);

export type H<T extends object> = T & { instanceId: string };

export const hashed = <T extends object>(value: T): H<T> => {
  if (Object.isExtensible(value)) {
    Object.assign(value, { instanceId: crypto.randomUUID() });

    return value as H<T>;
  }

  const error = new Error("Object is not extensible");
  Object.assign(error, { kidNammedObject: value });

  throw error;
};

export const shortId = (id: string) => id.slice(0, 6);

export const NOOP = (): void => undefined;
