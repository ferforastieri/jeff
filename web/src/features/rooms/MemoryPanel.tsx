import { Button as KitButton } from "@jeff/ui/kit";
import { Input as KitInput, Textarea as KitTextarea, NativeSelect as KitSelect } from "@jeff/ui/kit";
import { useEffect, useState } from "react";
import { Plus, Search, Trash2, X } from "@jeff/icons";
import { roomsApi, type Memory, type Principal } from "./api";

const field =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";

interface Props {
  bots: Principal[];
}

export default function MemoryPanel({ bots }: Props) {
  const [agentId, setAgentId] = useState(bots[0]?.id ?? "");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [inclusion, setInclusion] = useState<"essential" | "searchable">("searchable");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function refresh(search = query) {
    if (!agentId) return;
    try {
      const result = await roomsApi.memories(agentId, search.trim() || undefined);
      setMemories(result.memories);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler a memória.");
    }
  }

  useEffect(() => {
    void refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function add() {
    if (!text.trim()) return;
    try {
      await roomsApi.createMemory(agentId, {
        text: text.trim(),
        inclusion,
      });
      setText("");
      setAdding(false);
      await refresh("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a memória.");
    }
  }

  async function toggle(memory: Memory) {
    try {
      await roomsApi.updateMemory(memory.id, {
        inclusion: memory.inclusion === "essential" ? "searchable" : "essential",
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar a memória.");
    }
  }

  async function remove(memory: Memory) {
    try {
      await roomsApi.deleteMemory(memory.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível apagar a memória.");
    }
  }

  const bot = bots.find((item) => item.id === agentId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-1-medium">Memória</h2>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {bot ? `${bot.name} · ${memories.length} memória${memories.length === 1 ? "" : "s"}` : "escolha um bot"}
          </p>
        </div>
        <KitSelect raw
          className="rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1 text-caption-1-regular"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          {bots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </KitSelect>
        <KitButton variant="raw" className={primaryButton} onClick={() => setAdding(true)} disabled={!agentId}>
          <Plus size={14} /> Lembrar
        </KitButton>
      </header>

      {error ? (
        <p className="border-b border-separator-border px-4 py-2 text-caption-2-regular text-red-500">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-b border-separator-border px-4 py-2">
        <Search size={14} className="text-text-tertiary" />
        <KitInput raw
          className="min-w-0 flex-1 bg-transparent text-caption-1-regular text-text-primary outline-none placeholder:text-text-tertiary"
          placeholder="Buscar na memória deste bot"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void refresh();
          }}
        />
        <KitButton variant="raw" className={quietButton} onClick={() => void refresh()}>
          buscar
        </KitButton>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {memories.length === 0 ? (
          <p className="py-10 text-center text-caption-1-regular text-text-tertiary">
            Nada guardado ainda.
          </p>
        ) : (
          memories.map((memory) => (
            <article
              key={memory.id}
              className="flex items-start gap-2 rounded-xl border border-separator-border bg-background-secondary-default p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-body-2-regular">{memory.text}</p>
                <p className="mt-1 text-caption-2-regular text-text-tertiary">
                  {memory.origin} · revisão {memory.revision}
                  {memory.userControlled ? " · escolhida por você" : ""}
                </p>
              </div>
              <KitButton variant="raw"
                className={`${quietButton} ${
                  memory.inclusion === "essential" ? "text-accent-500" : ""
                }`}
                title="Memória essencial entra em todo prompt"
                onClick={() => void toggle(memory)}
              >
                {memory.inclusion === "essential" ? "sempre" : "sob busca"}
              </KitButton>
              <KitButton variant="raw" className={quietButton} onClick={() => void remove(memory)}>
                <Trash2 size={12} />
              </KitButton>
            </article>
          ))
        )}
      </div>

      {adding ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <section className="w-full max-w-md rounded-2xl border border-border-button-white bg-background-primary-default p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-body-1-medium">Lembrar</h3>
              <KitButton variant="raw" className={quietButton} onClick={() => setAdding(false)}>
                <X size={14} />
              </KitButton>
            </div>
            <KitTextarea raw
              className={`${field} min-h-28`}
              placeholder="O que este bot deve lembrar sempre?"
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
            />
            <div className="mt-2 flex gap-2">
              <label className="flex items-center gap-1 text-caption-1-regular">
                <KitInput raw
                  type="radio"
                  checked={inclusion === "searchable"}
                  onChange={() => setInclusion("searchable")}
                />
                sob busca
              </label>
              <label className="flex items-center gap-1 text-caption-1-regular">
                <KitInput raw
                  type="radio"
                  checked={inclusion === "essential"}
                  onChange={() => setInclusion("essential")}
                />
                sempre no prompt
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <KitButton variant="raw" className={quietButton} onClick={() => setAdding(false)}>
                Cancelar
              </KitButton>
              <KitButton variant="raw" className={primaryButton} onClick={() => void add()}>
                Salvar
              </KitButton>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
