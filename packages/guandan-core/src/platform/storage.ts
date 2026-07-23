export interface StorageBoundary<Value> {
  load(): Promise<Value | undefined>;
  save(value: Value): Promise<void>;
  clear(): Promise<void>;
}
