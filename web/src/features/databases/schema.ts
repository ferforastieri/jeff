import type { SchemaTable } from "../../shared/api";

/** Names shown for drivers whose schema field is just the engine's own name. */
const GENERIC_SCHEMAS: Record<string, string> = {
  redis: "Chaves",
  elasticsearch: "Índices",
  neo4j: "Rótulos",
};

const DRIVER_NAMES: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
  oracle: "Oracle",
  clickhouse: "ClickHouse",
  mongodb: "MongoDB",
  redis: "Redis",
  cassandra: "Cassandra",
  elasticsearch: "Elasticsearch",
  neo4j: "Neo4j",
};

export function driverName(driver: string): string {
  return DRIVER_NAMES[driver] ?? driver;
}

/** The group a table belongs to, in words that fit each engine. */
export function schemaLabel(schema: string, driver: string): string {
  const value = schema.trim();
  if (value && value !== "default" && value !== driver) return value;
  return GENERIC_SCHEMAS[driver] ?? (value || "Estrutura");
}

export interface SchemaGroup {
  schema: string;
  label: string;
  tables: SchemaTable[];
}

/** Keeps the server's order and groups by schema, so every engine reads the same. */
export function groupTables(tables: SchemaTable[], driver: string): SchemaGroup[] {
  const groups = new Map<string, SchemaTable[]>();
  for (const table of tables) {
    const list = groups.get(table.schema) ?? [];
    list.push(table);
    groups.set(table.schema, list);
  }
  return [...groups.entries()].map(([schema, list]) => ({
    schema,
    label: schemaLabel(schema, driver),
    tables: list,
  }));
}
