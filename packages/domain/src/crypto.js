import { id, AbiCoder } from 'ethers';
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const coder = AbiCoder.defaultAbiCoder();
export const topic = (network, kind, scope) =>
  (BigInt(id(`LOTUS:v2:${network}:${kind}:${scope}`)) % FIELD).toString();
export const signal = (kind, value, digest = '') =>
  (
    BigInt(id(coder.encode(['string', 'uint8', 'string'], [kind, value, digest]))) % FIELD
  ).toString();
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
