import { productMigrations } from "../domain/product-migrations";
import { now, type Sql } from "./sql";

export function migrateProduct(sql: Sql): void {
  for (const migration of productMigrations) {
    if (sql`SELECT version FROM schema_migrations WHERE version = ${migration.version}`.length)
      continue;
    for (const statement of migration.statements) {
      // Only compile checked-in schema statements. No user input enters this SQL.
      sql(Object.assign([statement], { raw: [statement] }));
    }
    sql`INSERT INTO schema_migrations (version, applied_at) VALUES (${migration.version}, ${now()})`;
  }
}
