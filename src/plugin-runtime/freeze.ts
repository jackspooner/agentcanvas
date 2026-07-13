export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Reflect.ownKeys(value).map((key) => Reflect.get(value, key))) deepFreeze(nested, seen);
  return Object.freeze(value);
}
