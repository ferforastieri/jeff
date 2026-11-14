import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Database, Folder, Layers, Plus, Table2, Trash2 } from "@toph/icons";
import { api, type DBProfile, type Project, type SchemaTable } from "../../../shared/api";
import { useApp } from "../../../app/store";
import { useConfirm } from "../../../shared/ui/confirm";
import { Button } from "@toph/ui/app";
import { Input } from "@toph/ui/app";
import { Checkbox } from "@toph/ui/app";
import { Badge } from "@toph/ui/app";
import { Select, SelectItem } from "@toph/ui/app";
import { Chip } from "@toph/ui/app";
import { useProjectEvents } from "../../projects/events";
import LoadingState from "../../../shared/ui/LoadingState";
import SidebarHeader from "../../../app/components/SidebarHeader";
import { groupTables } from "../schema";

interface Props {
  project: Project;
  onOpenTable: (profileId: string, table: SchemaTable, driver: string) => void;
  embedded?: boolean;
  headerControl?: ReactNode;
}

export default function DatabasesPanel({ project, onOpenTable, embedded = false, headerControl }: Props) {
  const [profiles, setProfiles] = useState<DBProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [schemas, setSchemas] = useState<Record<string, SchemaTable[] | undefined>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notify = useApp((state) => state.notify);
  const confirm = useConfirm();

  async function load(quiet = false): Promise<DBProfile[]> {
    if (!quiet) setBusy(true);
    try {
      const next = await api.dbProfiles(project.root);
      setProfiles(next);
      setError("");
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load connections.");
      return [];
    } finally { if (!quiet) setBusy(false); }
  }

  useEffect(() => { void load(); }, [project.root]);
  useProjectEvents(project.id, ["databases"], () => { void load(true); });

  async function toggle(profile: DBProfile) {
    const next = !expanded[profile.id];
    setExpanded((value) => ({ ...value, [profile.id]: next }));
    if (next && schemas[profile.id] === undefined) {
      try { const tables = await api.dbSchema(profile.id); setSchemas((value) => ({ ...value, [profile.id]: tables })); }
      catch (err) { notify("error", err instanceof Error ? err.message : "Could not read schema."); }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {embedded ? (
        <div className="shrink-0 border-b border-separator-border p-2">
          <Button variant="secondary" size="small" leadingIcon={Plus} className="w-full justify-start" onClick={() => setShowForm((value) => !value)}>Nova conexão</Button>
        </div>
      ) : (
        <SidebarHeader control={headerControl} icon={<Database size={15} className="text-accent-500" />} title="Databases" actions={<Button variant="ghost" size="xs" iconOnly leadingIcon={Plus} aria-label="Nova conexão" onClick={() => setShowForm((value) => !value)} />} />
      )}
      {showForm && <ConnectionForm projectRoot={project.root} onCreated={() => { setShowForm(false); void load(); }} />}
      {busy && <LoadingState label="Carregando..." className="px-1 py-1" />}
      {error && <Chip color="rose" variant="subtle" className="mx-2 mt-2 justify-start whitespace-normal px-2 py-1">{error}</Chip>}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {profiles.map((profile, index) => {
          const folder = profile.folder?.trim() || "Sem pasta";
          const showFolder = index === 0 || folder !== (profiles[index - 1]?.folder?.trim() || "Sem pasta");
          const tables = schemas[profile.id];
          return (
            <Fragment key={profile.id}>
              {showFolder && (
                <div className="mt-2 flex items-center gap-1.5 px-2 py-1 text-caption-2-semibold uppercase tracking-wide text-text-tertiary">
                  <Folder size={12} />
                  <span className="min-w-0 flex-1 truncate">{folder}</span>
                  <span className="shrink-0">{profiles.filter((item) => (item.folder?.trim() || "Sem pasta") === folder).length}</span>
                </div>
              )}
              <div className="group flex items-center gap-0.5 rounded-lg px-1 transition-colors hover:bg-background-secondary-default">
                <Button variant="ghost" size="small" className="h-8 min-w-0 flex-1 justify-start gap-2 px-1.5" onClick={() => void toggle(profile)}>
                  {expanded[profile.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-500/10 text-accent-500"><Database size={13} /></span>
                  <span className="truncate text-caption-1-medium text-text-primary" title={`${profile.name}${profile.readOnly ? " · read-only" : ""}`}>{profile.name}</span>
                  <Badge color="neutral" className="shrink-0 px-1 text-[9px] uppercase">{profile.driver}</Badge>
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-text-tertiary opacity-100 min-[901px]:opacity-0 min-[901px]:group-hover:opacity-100"
                  aria-label="Excluir conexão"
                  onClick={async () => {
                    const ok = await confirm({ title: "Excluir conexão?", message: `Excluir "${profile.name}" deste workspace?`, confirmLabel: "Excluir", danger: true });
                    if (!ok) return;
                    try { await api.deleteDBProfile(profile.id); await load(); }
                    catch (err) { notify("error", err instanceof Error ? err.message : "Could not delete."); }
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
              {expanded[profile.id] && (
                <div className="ms-4 border-s border-separator-border pb-1 ps-2">
                  {tables === undefined ? (
                    <p className="px-2 py-1.5 text-caption-1-regular text-text-tertiary">Lendo schema…</p>
                  ) : tables.length === 0 ? (
                    <p className="px-2 py-1.5 text-caption-1-regular text-text-tertiary">Sem tabelas.</p>
                  ) : (
                    groupTables(tables, profile.driver).map((group) => (
                      <div key={group.schema || "default"} className="mt-1.5">
                        <div className="flex items-center gap-1.5 px-2 pb-1 text-caption-2-semibold uppercase tracking-wide text-text-tertiary">
                          <Layers size={12} />
                          <span className="min-w-0 flex-1 truncate">{group.label}</span>
                          <span className="shrink-0">{group.tables.length}</span>
                        </div>
                        {group.tables.map((table) => {
                          const key = `${profile.id}:${table.schema}.${table.name}`;
                          const open = Boolean(expandedTables[key]);
                          return (
                            <div key={key}>
                              <div className="flex items-center gap-0.5 rounded-lg transition-colors hover:bg-background-secondary-default">
                                <Button variant="ghost" size="xs" iconOnly aria-label={open ? "Ocultar colunas" : "Mostrar colunas"} title={open ? "Ocultar colunas" : "Mostrar colunas"} onClick={() => setExpandedTables((value) => ({ ...value, [key]: !open }))}>
                                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </Button>
                                <Button variant="ghost" size="small" className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-1" onClick={() => onOpenTable(profile.id, table, profile.driver)} title={`Abrir ${table.schema}.${table.name}`}>
                                  <Table2 size={13} className="shrink-0 text-foreground-icon-secondary" />
                                  <span className="truncate text-caption-1-regular text-text-primary">{table.name}</span>
                                  <span className="ms-auto shrink-0 rounded-full bg-background-tertiary-default px-1.5 text-[10px] leading-4 text-text-tertiary">{table.columns.length}</span>
                                </Button>
                              </div>
                              {open && (
                                <div className="db-columns flex flex-col gap-0.5 pb-1">
                                  {table.columns.length === 0 ? (
                                    <span className="px-2 py-0.5 text-caption-2-regular text-text-tertiary">Sem colunas.</span>
                                  ) : table.columns.map((column) => (
                                    <div key={`${key}:${column.name}`} className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors hover:bg-background-secondary-default">
                                      <span className={`min-w-0 flex-1 truncate ${column.primary ? "font-medium text-text-primary" : "text-text-secondary"}`}>{column.name}</span>
                                      <span className="shrink-0 truncate text-[10px] text-text-tertiary">{column.type}</span>
                                      {column.primary && <span className="shrink-0 rounded bg-accent-500/15 px-1 text-[9px] font-semibold leading-4 text-accent-600">PK</span>}
                                      {column.nullable && <span className="shrink-0 text-[9px] leading-4 text-text-tertiary">NULL</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
        {!busy && profiles.length === 0 && !showForm && (
          <div className="bg-background-secondary-default m-1 flex flex-col items-center gap-2 rounded-lg border p-6 text-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-background-tertiary-default text-foreground-icon-secondary"><Database size={20} /></span>
            <strong className="text-body-medium text-text-primary">Nenhuma conexão</strong>
            <p className="text-caption-1-regular text-text-secondary">Adicione um banco para consultar tabelas e rodar SQL.</p>
            <Button variant="secondary" size="small" onClick={() => setShowForm(true)}>Adicionar conexão</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionForm({ projectRoot, onCreated }: { projectRoot: string; onCreated: () => void }) {
  const notify = useApp((state) => state.notify);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [driver, setDriver] = useState("postgres");
  const [dsn, setDsn] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const hints: Record<string, string> = {
    postgres: "postgres://user:pass@host:5432/db?sslmode=disable", mysql: "user:pass@tcp(host:3306)/db", sqlite: "/path/to/database.db",
    sqlserver: "sqlserver://user:pass@host:1433?database=db", oracle: "oracle://user:pass@host:1521/service", clickhouse: "clickhouse://user:pass@host:9000/db",
    mongodb: "mongodb://user:pass@host:27017", redis: "redis://user:pass@host:6379/0", cassandra: "cassandra://host:9042/keyspace",
    elasticsearch: "http://user:pass@host:9200", neo4j: "neo4j://user:pass@host:7687",
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await api.createDBProfile({ name, folder, projectRoot, driver, dsn, readOnly }); notify("success", "Conexão adicionada."); onCreated(); }
    catch (err) { notify("error", err instanceof Error ? err.message : "Could not add connection."); }
    finally { setBusy(false); }
  }
  return (
    <form className="flex shrink-0 flex-col gap-2 border-b p-2" onSubmit={submit}>
      <Input placeholder="Connection name" value={name} onChange={setName} isRequired />
      <Input placeholder="Folder (optional)" value={folder} onChange={setFolder} />
      <Select selectedKey={driver} onSelectionChange={(key) => setDriver(String(key))} aria-label="Driver" className="w-full">
        {[["postgres","PostgreSQL"],["mysql","MySQL / MariaDB"],["sqlite","SQLite"],["sqlserver","SQL Server"],["oracle","Oracle"],["clickhouse","ClickHouse"],["mongodb","MongoDB"],["redis","Redis"],["cassandra","Cassandra"],["elasticsearch","Elasticsearch"],["neo4j","Neo4j"]].map(([value, label]) => <SelectItem key={value} id={value}>{label}</SelectItem>)}
      </Select>
      <Input placeholder={hints[driver]} value={dsn} onChange={setDsn} isRequired />
      <Checkbox isSelected={readOnly} onChange={setReadOnly}>Somente leitura</Checkbox>
      <Button type="submit" size="small" disabled={busy} className="w-full">{busy ? "Adicionando..." : "Adicionar conexão"}</Button>
    </form>
  );
}
