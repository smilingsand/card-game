// Shared Guandan core source.
type StructuredClone = <Value>(value: Value) => Value;

/** 将标准运行时 API 收敛为显式边界，避免依赖环境对 DOM 全局声明的合并方式。 */
export function cloneValue<Value>(value: Value): Value {
  const clone = Reflect.get(globalThis, "structuredClone");
  if (typeof clone !== "function") {
    throw new Error("structuredClone is unavailable in this runtime");
  }
  return (clone as StructuredClone)(value);
}
