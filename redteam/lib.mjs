/** Small deterministic helpers shared by the attack simulations. */
export function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function poisson(rand, lambda) {
  // Knuth; fine for the small rates used here
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

/** Two-sample Kolmogorov–Smirnov statistic and approximate p-value. */
export function ksTest(a, b) {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  // Step through every distinct value so ties move both CDFs together (data here are integers).
  let i = 0, j = 0, d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] === v) i++;
    while (j < y.length && y[j] === v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  const n = (x.length * y.length) / (x.length + y.length);
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  return { d, p: Math.min(1, Math.max(0, p)) };
}

export const popcount = (n) => n.toString(2).split("").filter((c) => c === "1").length;
export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
