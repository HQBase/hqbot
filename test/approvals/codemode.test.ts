import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { CodemodeRuntime } from "../../node_modules/@cloudflare/codemode/dist/index.js";

it("rejects a replayed approval after the execution reaches its next action", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const sql = {
      exec(query: string, ...values: (string | number | null)[]) {
        if (query.includes("CREATE TABLE")) {
          database.exec(query);
          return { toArray: () => [] };
        }
        const rows = database.prepare(query).all(...values);
        return { toArray: () => rows, one: () => rows[0] };
      }
    };
    const runtime = new CodemodeRuntime(
      { storage: { sql } } as unknown as ConstructorParameters<typeof CodemodeRuntime>[0],
      {}
    );
    const id = await runtime.begin("two actions");
    expect((await runtime.decide(id, 0, "service", "first", {}, true)).kind).toBe("pause");
    expect(await runtime.resume(id, 0)).not.toBeNull();
    expect((await runtime.decide(id, 0, "service", "first", {}, true)).kind).toBe("execute");
    await runtime.recordResult(id, 0, { ok: true });
    expect((await runtime.decide(id, 1, "service", "second", {}, true)).kind).toBe("pause");
    expect(await runtime.resume(id, 0)).toBeNull();
    expect((await runtime.decide(id, 1, "service", "second", {}, true)).kind).toBe("pause");
    expect(await runtime.resume(id, 1)).not.toBeNull();
  } finally {
    database.close();
  }
});
