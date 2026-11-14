import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Database, Folder, Layers, Plus, Table2, Trash2 } from "@toph/icons";
import { api, type DBProfile, type Project, type SchemaTable } from "../../../../shared/api";
import { useApp } from "../../../store";
import { useConfirm } from "../../../../shared/ui/confirm";
import { useProjectEvents } from "../../../../features/projects/events";
import { Badge } from "@toph/ui/app";
import { Button } from "@toph/ui/app";
import { Checkbox } from "@toph/ui/app";
import { Input } from "@toph/ui/app";
import { Modal } from "@toph/ui/app";
import { Select, SelectItem } from "@toph/ui/app";
import LoadingState from "../../../../shared/ui/LoadingState";
import { driverName, groupTables } from "../../../../features/databases/schema";

interface Props {
  project: Project;
  onOpenTable: (profileId: string, table: SchemaTable, driver: string) => void;
}

const DRIVERS = [
  ["postgres", "PostgreSQL"], ["mysql", "MySQL / MariaDB"], ["sqlite", "SQLite"], ["sqlserver", "SQL Server"],
  ["oracle", "Oracle"], ["clickhouse", "ClickHouse"], ["mongodb", "MongoDB"], ["redis", "Redis"],
  ["cassandra", "Cassandra"], ["elasticsearch", "Elasticsearch"], ["neo4j", "Neo4j"],
];

const HINTS: Record<string, string> = {
  postgres: "postgres://user:pass@host:5432/db",
  mysql: "user:pass@tcp(host:3306)/db",
  sqlite: "/path/to/database.db",
  sqlserver: "sqlserver://user:pass@host:1433?database=db",
  oracle: "oracle://user:pass@host:1521/service",
  clickhouse: "clickhouse://user:pass@host:9000/db",
  mongodb: "mongodb://user:pass@host:27017",
  redis: "redis://user:pass@host:6379/0",
  cassandra: "cassandra://host:9042/keyspace",
  elasticsearch: "http://user:pass@host:9200",
  neo4j: "neo4j://user:pass@host:7687",
};

export default function DatabasesScreen({ project, onOpenTable }: Props) {
  const notify = useApp((state) => state.notify);
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<DBProfile[]>([]);
  const [schemas, setSchemas] = useState<Record<string, SchemaTable[] | undefined>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      setProfiles(await api.dbProfiles(project.root));
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Não foi possível carregar as conexões.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [project.root]);
  useProjectEvents(project.id, ["databases"], () => void load(true));

  async function toggle(profile: DBProfile) {
    const next = !expanded[profile.id];
    setExpanded((value) => ({ ...value, [profile.id]: next }));
    if (next && !schemas[profile.id]) {
      setBusy(profile.id);
      try {
        setSchemas((value) => ({ ...value, [profile.id]: [] }));
        const tables = await api.dbSchema(profile.id);
        setSchemas((value) => ({ ...value, [profile.id]: tables }));
      } catch (err) {
        notify("error", err instanceof Error ? err.message : "Não foi possível ler o schema.");
      } finally {
        setBusy("");
      }
    }
  }

  async function remove(profile: DBProfile) {
    const ok = await confirm({
      title: "Excluir conexão?",
      message: `Excluir "${profile.name}" deste workspace?`,
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteDBProfile(profile.id);
      await load(true);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Não foi possível excluir.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background-secondary-default">
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <Button className="h-11 w-full justify-center" leadingIcon={Plus} onClick={() => setFormOpen(true)}>
          Nova conexão
        </Button>

        {loading ? <LoadingState label="Carregando conexões..." className="py-6" /> : null}
        {!loading && profiles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-border-button-white bg-background-primary-default p-6 text-center shadow-xs">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-500">
              <Database className="size-6" />
            </span>
            <strong className="text-title-3-medium text-text-primary">Nenhuma conexão</strong>
            <p className="text-caption-1-regular text-text-secondary">Adicione um banco para consultar tabelas e executar queries.</p>
          </div>
        ) : null}

        {profiles.map((profile) => {
          const open = Boolean(expanded[profile.id]);
          const tables = schemas[profile.id];
          return (
            <section key={profile.id} className="overflow-hidden rounded-3xl border border-border-button-white bg-background-primary-default shadow-xs">
              <button type="button" className="flex w-full items-center gap-3 p-3 text-start" onClick={() => void toggle(profile)}>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-500">
                  <Database className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body-2-medium text-text-primary">{profile.name}</span>
                  <span className="flex items-center gap-1 truncate text-caption-2-regular text-text-tertiary">
                    <Folder className="size-3" /> {profile.folder || "Sem pasta"} · {driverName(profile.driver)}
                  </span>
                </span>
                {profile.readOnly ? <Badge color="neutral">read-only</Badge> : null}
                {open ? <ChevronDown className="size-5 text-text-tertiary" /> : <ChevronRight className="size-5 text-text-tertiary" />}
              </button>

              {open ? (
                <div className="border-t border-separator-border px-2 pb-2 pt-1">
                  {busy === profile.id ? <LoadingState label="Lendo schema..." className="py-2" /> : null}
                  {busy !== profile.id && tables?.length === 0 ? <p className="px-2 py-3 text-caption-1-regular text-text-secondary">Sem tabelas.</p> : null}
                  {busy !== profile.id && tables && tables.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {groupTables(tables, profile.driver).map((group) => (
                        <section key={group.schema || "default"}>
                          <div className="flex items-center gap-1.5 px-2 py-1.5 text-caption-2-semibold uppercase tracking-wide text-text-tertiary">
                            <Layers className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{group.label}</span>
                            <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 text-[10px] leading-4">{group.tables.length}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {group.tables.map((table) => {
                              const key = `${profile.id}:${table.schema}.${table.name}`;
                              const columnsOpen = Boolean(expandedTables[key]);
                              return (
                                <div key={key}>
                                  <div className="flex items-center gap-0.5 rounded-2xl transition-colors hover:bg-background-secondary-default">
                                    <button
                                      type="button"
                                      className="flex size-9 shrink-0 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                                      aria-label={columnsOpen ? "Ocultar colunas" : "Mostrar colunas"}
                                      title={columnsOpen ? "Ocultar colunas" : "Mostrar colunas"}
                                      onClick={() => setExpandedTables((value) => ({ ...value, [key]: !columnsOpen }))}
                                    >
                                      {columnsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                    </button>
                                    <button
                                      type="button"
                                      className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl px-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                                      onClick={() => onOpenTable(profile.id, table, profile.driver)}
                                    >
                                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background-tertiary-default text-foreground-icon-secondary">
                                        <Table2 className="size-4" />
                                      </span>
                                      <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-caption-1-medium text-text-primary">{table.name}</span>
                                        <span className="truncate text-caption-2-regular text-text-tertiary">{table.columns.length} colunas</span>
                                      </span>
                                      <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
                                    </button>
                                  </div>
                                  {columnsOpen ? (
                                    <div className="db-columns flex flex-col gap-0.5 pb-1">
                                      {table.columns.length === 0 ? (
                                        <p className="px-2 py-1 text-caption-2-regular text-text-tertiary">Sem colunas.</p>
                                      ) : table.columns.map((column) => (
                                        <div key={`${key}:${column.name}`} className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-background-secondary-default">
                                          <span className={`min-w-0 flex-1 truncate ${column.primary ? "font-medium text-text-primary" : "text-text-secondary"}`}>{column.name}</span>
                                          <span className="shrink-0 truncate text-[10px] text-text-tertiary">{column.type}</span>
                                          {column.primary ? <span className="shrink-0 rounded bg-accent-500/15 px-1 text-[9px] font-semibold leading-4 text-accent-600">PK</span> : null}
                                          {column.nullable ? <span className="shrink-0 text-[9px] leading-4 text-text-tertiary">NULL</span> : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex justify-end border-t border-separator-border pt-1">
                    <Button variant="ghost" size="small" leadingIcon={Trash2} onClick={() => void remove(profile)}>Excluir</Button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="Nova conexão" description="Adicione um banco ao workspace." size="sm" bodyClassName="p-3">
        <ConnectionForm
          projectRoot={project.root}
          onCreated={() => { setFormOpen(false); void load(true); }}
        />
      </Modal>
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createDBProfile({ name, folder, projectRoot, driver, dsn, readOnly });
      notify("success", "Conexão adicionada.");
      onCreated();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Não foi possível adicionar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Input placeholder="Nome da conexão" value={name} onChange={setName} isRequired fieldClassName="h-10" />
      <Input placeholder="Pasta (opcional)" value={folder} onChange={setFolder} fieldClassName="h-10" />
      <Select selectedKey={driver} onSelectionChange={(key) => setDriver(String(key))} aria-label="Driver" className="w-full">
        {DRIVERS.map(([value, label]) => <SelectItem key={value} id={value}>{label}</SelectItem>)}
      </Select>
      <Input placeholder={HINTS[driver]} value={dsn} onChange={setDsn} isRequired fieldClassName="h-10" />
      <Checkbox isSelected={readOnly} onChange={setReadOnly}>Somente leitura</Checkbox>
      <Button type="submit" className="h-11 w-full justify-center" disabled={busy || !name.trim() || !dsn.trim()}>
        {busy ? "Adicionando..." : "Adicionar conexão"}
      </Button>
    </form>
  );
}
