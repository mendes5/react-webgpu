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
