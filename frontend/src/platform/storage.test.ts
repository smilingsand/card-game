import { describe, expect, test } from "vitest";
import { StorageUnavailableError, createIndexedDbStorage } from "./storage";

describe("IndexedDB 存储边界", () => {
  test("在没有浏览器 IndexedDB 的运行时仅在调用时失败，创建本身 SSR-safe", async () => {
    const storage = createIndexedDbStorage<{ readonly value: string }>({
      databaseName: "test",
      storeName: "saves",
      key: "current"
    });

    await expect(storage.load()).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
