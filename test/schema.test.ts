import { describe, expect, it } from "vitest";

import { pendingMigrations, schemaMigrations } from "../src/domain/schema";

describe("schema migrations", () => {
  it("builds a fresh Durable Object with every migration", () => {
    expect(pendingMigrations([])).toEqual(schemaMigrations);
  });

  it("does not repeat an applied migration during update", () => {
    expect(pendingMigrations([1])).toEqual(schemaMigrations.slice(1));
    expect(pendingMigrations([1, 2])).toEqual(schemaMigrations.slice(2));
    expect(pendingMigrations([1, 2, 3])).toEqual(schemaMigrations.slice(3));
    expect(pendingMigrations([1, 2, 3, 4])).toEqual(schemaMigrations.slice(4));
    expect(pendingMigrations([1, 2, 3, 4, 5])).toEqual([schemaMigrations[5]]);
    expect(pendingMigrations([1, 2, 3, 4, 5, 6])).toEqual([]);
  });

  it("keeps versions ordered and unique", () => {
    const versions = schemaMigrations.map((migration) => migration.version);
    expect(versions).toEqual([...new Set(versions)].sort((left, right) => left - right));
  });
});
