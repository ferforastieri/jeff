import { describe, expect, it } from "vitest";
import type { SchemaTable } from "../../shared/api";
import { driverName, groupTables, schemaLabel } from "./schema";

function table(schema: string, name: string): SchemaTable {
  return { schema, name, columns: [] };
}

describe("database schema tree", () => {
  it("groups tables by schema and keeps the server order", () => {
    const groups = groupTables(
      [table("public", "users"), table("public", "posts"), table("audit", "events")],
      "postgres",
    );
    expect(groups.map((group) => [group.label, group.tables.map((item) => item.name)])).toEqual([
      ["public", ["users", "posts"]],
      ["audit", ["events"]],
    ]);
  });

  it("names the generic group of each engine in words", () => {
    expect(schemaLabel("redis", "redis")).toBe("Chaves");
    expect(schemaLabel("elasticsearch", "elasticsearch")).toBe("Índices");
    expect(schemaLabel("neo4j", "neo4j")).toBe("Rótulos");
    expect(schemaLabel("main", "sqlite")).toBe("main");
    expect(schemaLabel("", "mysql")).toBe("Estrutura");
  });

  it("shows friendly driver names", () => {
    expect(driverName("postgres")).toBe("PostgreSQL");
    expect(driverName("sqlite")).toBe("SQLite");
    expect(driverName("custom")).toBe("custom");
  });
});
