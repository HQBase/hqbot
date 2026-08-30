import { describe, expect, it } from "vitest"

import { pendingMigrations, schemaMigrations } from "../src/domain/schema"

describe("schema migrations", () => {
  it("builds a fresh Durable Object with every migration", () => {
    expect(pendingMigrations([])).toEqual(schemaMigrations)
  })

  it("does not repeat an applied migration during update", () => {
    expect(pendingMigrations([1])).toEqual([schemaMigrations[1]])
    expect(pendingMigrations([1, 2])).toEqual([])
  })

  it("keeps versions ordered and unique", () => {
    const versions = schemaMigrations.map((migration) => migration.version)
    expect(versions).toEqual([...new Set(versions)].sort((left, right) => left - right))
  })
})
