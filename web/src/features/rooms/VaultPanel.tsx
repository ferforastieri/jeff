import { Button as KitButton } from "@jeff/ui/kit";
import { Input as KitInput, NativeSelect as KitSelect } from "@jeff/ui/kit";
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "@jeff/icons";
import { api, type Project } from "../../shared/api";

const field =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";

type Items = Awaited<ReturnType<typeof api.vault>>["items"];

export default function VaultPanel({ project }: { project: Project }) {
  const [items, setItems] = useState<Items>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"login" | "card">("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [holder, setHolder] = useState("");

  async function refresh() {
    try {
      const result = await api.vault(project.id);
      setItems(result.items);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error && "status" in cause && (cause as { status: number }).status === 403
          ? "Só o admin do time vê o cofre."
          : "Não foi possível ler o cofre.",
      );
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function add() {
    if (!name.trim() || !secret.trim()) {
      setError("Nome e segredo são obrigatórios.");
      return;
    }
    try {
      await api.addVault(project.id, {
        kind,
        name: name.trim(),
        username: username.trim(),
        secret: secret.trim(),
        meta: kind === "card" ? { expiry, cvc, holder } : {},
      });
      setAdding(false);
      setName("");
      setUsername("");
      setSecret("");
      setExpiry("");
      setCvc("");
      setHolder("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Apagar este item do cofre?")) return;
    try {
      await api.deleteVault(project.id, id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível apagar.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-1-medium">Cofre</h2>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            O bot preenche sem ver a senha. O segredo fica criptografado no servidor.
          </p>
        </div>
        <KitButton variant="raw" className={primaryButton} onClick={() => setAdding(true)}>
          <Plus size={14} /> Novo item
        </KitButton>
      </header>

      {error ? (
        <p className="border-b border-separator-border px-4 py-2 text-caption-2-regular text-red-500">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="py-10 text-center text-caption-1-regular text-text-tertiary">
            Nenhum login ou cartão guardado.
          </p>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="flex items-center gap-2 rounded-xl border border-separator-border bg-background-secondary-default px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-2-medium">{item.name}</span>
                <span className="block truncate text-caption-2-regular text-text-tertiary">
                  {item.kind === "card" ? "cartão" : item.username || "login"}
                </span>
              </span>
              <KitButton variant="raw" className={quietButton} onClick={() => void remove(item.id)}>
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
              <h3 className="text-body-1-medium">Novo item</h3>
              <KitButton variant="raw" className={quietButton} onClick={() => setAdding(false)}>
                <X size={14} />
              </KitButton>
            </div>
            <div className="space-y-2">
              <KitSelect raw
                className={field}
                value={kind}
                onChange={(event) => setKind(event.target.value as "login" | "card")}
              >
                <option value="login">Login</option>
                <option value="card">Cartão</option>
              </KitSelect>
              <KitInput raw
                className={field}
                placeholder="Nome (ex.: Banco)"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
              {kind === "login" ? (
                <KitInput raw
                  className={field}
                  placeholder="Usuário"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <KitInput raw
                    className={field}
                    placeholder="Validade MM/AA"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                  <KitInput raw
                    className={field}
                    placeholder="CVC"
                    value={cvc}
                    onChange={(event) => setCvc(event.target.value)}
                  />
                  <KitInput raw
                    className={`${field} col-span-2`}
                    placeholder="Nome impresso"
                    value={holder}
                    onChange={(event) => setHolder(event.target.value)}
                  />
                </div>
              )}
              <KitInput raw
                className={field}
                type="password"
                placeholder={kind === "card" ? "Número do cartão" : "Senha"}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
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
