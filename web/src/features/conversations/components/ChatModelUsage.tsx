import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ExternalLink, LoaderCircle, RefreshCw } from "@toph/icons";
import { cx } from "@toph/ui";
import { engineApi, type UsageLimits, type UsageWindow } from "../../agents/api";
import ProviderIcon from "../../providers/components/ProviderIcon";
import {
  defaultModel,
  findModel,
  modelBrand,
  modelDisplay,
  modelGroup,
  providerLabel,
  rememberModel,
  useAI,
} from "../../providers/store";
import type { AIModel } from "../../../shared/api";
import { useChats, type ChatToph, type TophChat } from "../store";
import ComposerMenu from "./ComposerMenu";
import { effortLabel } from "../../providers/components/ModelPicker";
import { useIsMobile } from "../../../shared/ui/useIsMobile";

interface Props {
  projectId: string;
  chat: TophChat;
  tophs: ChatToph[];
  chatName: string;
}

const CIRCUMFERENCE = 2 * Math.PI * 11.5;
const WINDOWS: Array<{ key: keyof NonNullable<UsageLimits["go"]>; label: string }> = [
  { key: "rolling", label: "5 horas" },
  { key: "weekly", label: "Semanal" },
  { key: "monthly", label: "Mensal" },
];

function remaining(window: UsageWindow | undefined): number | null {
  if (!window) return null;
  if (window.limited) return 0;
  return Math.max(0, Math.min(100, 100 - Math.round(window.percent)));
}

function resetIn(value: number | undefined): string {
  if (!value) return "—";
  const minutes = Math.ceil((value - Date.now()) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes <= 0) return "agora";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function time(value: number): string {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function tone(left: number | null): string {
  if (left == null) return "stroke-border-button-default";
  if (left <= 10) return "stroke-status-rose-text";
  if (left <= 30) return "stroke-status-yellow-text";
  return "stroke-accent-500";
}

/**
 * One control for the conversation's model and the plan's consumption: the
 * chosen model's own mark inside a ring that shows what is left of the plan.
 * The desktop keeps both side by side; the phone uses two compact tabs.
 */
export default function ChatModelUsage({ projectId, chat, tophs, chatName }: Props) {
  const models = useAI((state) => state.models);
  const config = useAI((state) => state.config);
  const loadModels = useAI((state) => state.loadModels);
  const updateChatToph = useChats((state) => state.updateChatToph);
  const mobile = useIsMobile();
  const member = tophs[0] ?? null;
  const override = member ? chat.tophSettings?.[member.id] ?? {} : {};
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"model" | "usage">("model");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [limits, setLimits] = useState<UsageLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState("");

  const model = override.model || member?.model || defaultModel(models, config);
  const effort = override.effort ?? member?.effort ?? "";
  const found = findModel(models, model);
  // The engine follows the selected model, so there is no second selector.
  const engine = found?.engine || override.engine || member?.engine || "opencode";
  const info: { id: string; label?: string; provider?: string; connectionLabel?: string } | undefined = found ?? (model ? { id: model, label: model.split("::").pop() ?? model } : undefined);
  const group = info ? modelGroup({ id: info.id, label: info.label ?? info.id, provider: info.provider, connectionLabel: info.connectionLabel }) : engine;
  const brand = info ? modelBrand({ id: info.id, label: info.label ?? info.id, provider: info.provider, connectionLabel: info.connectionLabel }) : engine === "antigravity" ? "gemini" : engine;
  const shortLabel = info?.label?.split(" ")[0] || "Modelo";

  useEffect(() => {
    if (models.length === 0) void loadModels();
  }, [models.length, loadModels]);

  // Older conversations stored only the model; keep the engine in sync with it.
  useEffect(() => {
    if (!member || !found?.engine || override.engine === found.engine) return;
    updateChatToph(projectId, chat.id, member.id, { engine: found.engine });
  }, [member, found?.engine, override.engine, projectId, chat.id, updateChatToph]);

  const load = useCallback(async (manual = false) => {
    if (engine !== "opencode") {
      setLimits(null);
      setError("");
      setLoading(false);
      return;
    }
    if (manual) setRefreshing(true);
    try {
      const result = await engineApi.limits(engine);
      if (result.ok) {
        setLimits(result.data ?? null);
        const engineLabel = engine === "opencode" ? "OpenCode" : engine === "antigravity" ? "Antigravity CLI" : "Codex";
        setError(result.data ? "" : `O ${engineLabel} não está conectado a uma conta.`);
      } else {
        setError(result.message ?? "Limite do plano indisponível.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Limite do plano indisponível.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setUpdatedAt(Date.now());
    }
  }, [engine]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const go = limits?.go;
  const windows = WINDOWS.map((item) => ({ ...item, window: go?.[item.key], left: remaining(go?.[item.key]) }));
  const tightest = useMemo(() => {
    const values = windows.filter((item) => item.window);
    if (values.length === 0) return null;
    return values.reduce((worst, item) => ((item.window?.percent ?? 0) > (worst.window?.percent ?? 0) ? item : worst));
  }, [go]);
  const left = tightest?.left ?? null;
  const remainingLabel = left == null ? "Limite do plano indisponível" : `Restante do plano: ${left}%`;

  const groups = useMemo(() => {
    const grouped = new Map<string, AIModel[]>();
    for (const item of models) {
      const key = modelGroup(item);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => {
      if (a === group) return -1;
      if (b === group) return 1;
      return providerLabel(a).localeCompare(providerLabel(b));
    });
  }, [models, group]);

  if (!member) return null;

  function choose(item: AIModel) {
    const nextVariants = item.variants ?? [];
    updateChatToph(projectId, chat.id, member!.id, {
      model: item.id,
      engine: item.engine ?? "opencode",
      ...(nextVariants.includes(effort) ? {} : { effort: "" }),
    });
    // A new task starts on the last model picked here instead of the harness default.
    rememberModel(item.id);
    setOpen(false);
  }

  function toggleGroup(provider: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  const modelList = (
    <div className="model-usage-list">
      {groups.length === 0 ? (
        <p className="px-2 py-3 text-caption-1-regular text-text-tertiary">Salve a configuração para carregar os modelos.</p>
      ) : groups.map(([provider, items]) => {
        const expanded = !collapsed.has(provider);
        return (
          <div key={provider} className="mb-1">
            <button
              type="button"
              onClick={() => toggleGroup(provider)}
              aria-expanded={expanded}
              aria-label={`${providerLabel(provider)} — ${expanded ? "recolher modelos" : "expandir modelos"}`}
              title={`${expanded ? "Recolher" : "Expandir"} ${providerLabel(provider)}`}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-start transition-colors hover:bg-background-secondary-hover"
            >
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{providerLabel(provider)}</span>
              <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 text-[10px] text-text-tertiary">{items.length}</span>
              <ChevronDown size={12} className={cx("shrink-0 text-text-tertiary transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", expanded ? "rotate-180" : "")} />
            </button>
            {expanded ? items.map((item) => {
              const active = item.id === model;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => choose(item)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
                    active
                      ? "bg-background-secondary-hover text-text-primary"
                      : "text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary",
                  )}
                >
                  <ProviderIcon provider={modelBrand({ id: item.id, label: item.label ?? item.id, provider: item.provider, connectionLabel: item.connectionLabel })} className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={item.label}>{item.label}</span>
                  {active && item.variants?.length ? <span className="shrink-0 text-[10px] text-text-tertiary">{effortLabel(effort)}</span> : null}
                  {active ? <Check size={13} className="shrink-0 text-accent-500" /> : null}
                </button>
              );
            }) : null}
          </div>
        );
      })}
    </div>
  );

  const usageBody = (
    <>
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default">
          <ProviderIcon provider={brand} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-body-medium text-text-primary">Consumo do plano</strong>
          <p className="truncate text-caption-2-regular text-text-tertiary">
            #{chatName}{limits?.workspace?.name ? ` · ${limits.workspace.name}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="flex size-8 shrink-0 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-background-primary-hover hover:text-text-primary disabled:opacity-50"
          aria-label="Atualizar consumo"
          title="Atualizar consumo"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && !limits ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-background-secondary-default px-3 py-2 text-caption-1-regular text-text-secondary">
          <LoaderCircle className="size-4 animate-spin" /> Consultando o OpenCode…
        </p>
      ) : null}

      {go ? (
        <div className="mt-3 divide-y divide-separator-border overflow-hidden rounded-2xl border border-border-button-default bg-background-secondary-default/60">
          {windows.map(({ key, label: windowLabel, window, left: value }) => {
            const used = value == null ? null : 100 - value;
            return (
              <div key={key} className="px-3 py-2.5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-caption-1-semibold text-text-primary">{windowLabel}</span>
                    <span className={cx(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                      used == null
                        ? "bg-background-tertiary-default text-text-tertiary"
                        : used >= 90
                          ? "bg-status-rose-bg text-status-rose-text"
                          : "bg-status-lime-bg text-status-lime-text",
                    )}>
                      {used == null ? "sem dados" : `${used}% usado`}
                    </span>
                  </div>
                  <span className="shrink-0 text-caption-2-regular text-text-tertiary">
                    {window ? `Renova em ${resetIn(window.resetsAt)}` : "—"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
                  <div
                    className={cx(
                      "h-full rounded-full transition-[width] duration-500",
                      used == null ? "bg-text-tertiary/30" : used >= 90 ? "bg-status-rose-text" : "bg-status-lime-text",
                    )}
                    style={{ width: `${used ?? 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && !go && !error ? (
        <p className="mt-3 rounded-xl bg-background-secondary-default px-3 py-2 text-caption-1-regular text-text-secondary">Nenhuma janela de limite disponível para esta conta.</p>
      ) : null}
      {error ? <p className="mt-3 rounded-xl bg-status-rose-bg px-3 py-2 text-caption-1-regular text-status-rose-text">{error}</p> : null}

      {limits?.workspace?.usageURL ? (
        <a
          href={limits.workspace.usageURL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-caption-1-medium text-accent-600 hover:text-accent-500"
        >
          Ver consumo no OpenCode <ExternalLink size={12} />
        </a>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-text-tertiary">
        Percentual usado do limite do OpenCode Go. Atualiza a cada minuto.
        {updatedAt ? ` Última leitura às ${time(updatedAt)}.` : ""}
      </p>
    </>
  );

  return (
    <ComposerMenu
      label="Modelo e consumo"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <>
        <span
          className="relative inline-flex size-[26px] shrink-0 items-center justify-center rounded-full outline-none"
          title={`${modelDisplay(info)} · ${remainingLabel}`}
        >
          <svg viewBox="0 0 26 26" className="absolute inset-0 size-full -rotate-90" aria-hidden>
            <circle cx="13" cy="13" r="11.5" fill="none" strokeWidth="1.6" className="stroke-border-button-default" />
            {left != null ? (
              <circle
                cx="13"
                cy="13"
                r="11.5"
                fill="none"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - left / 100)}
                className={cx("transition-[stroke-dashoffset] duration-500", tone(left))}
              />
            ) : null}
          </svg>
          <ProviderIcon provider={brand} className="relative size-3.5 text-text-primary" />
        </span>
        {mobile ? <span className="min-w-0 max-w-[76px] truncate text-caption-2-regular text-text-tertiary">{shortLabel}</span> : null}
        </>
      }
      triggerClassName="justify-center"
      popoverClassName="model-usage-popover p-0"
      contentClassName="p-0"
    >
      {() => mobile ? (
        <div className="model-usage-mobile">
          <div className="model-usage-head">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default">
              <ProviderIcon provider={brand} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-body-2-medium text-text-primary">{info?.label ?? "Modelo"}</strong>
              <span className="block truncate text-caption-2-regular text-text-tertiary">{providerLabel(group)} · {effortLabel(effort)}</span>
            </div>
          </div>
          <div className="model-usage-tabs" role="tablist" aria-label="Modelo e consumo">
            <button type="button" role="tab" aria-selected={tab === "model"} data-active={tab === "model"} className="model-usage-tab" onClick={() => setTab("model")}>Modelo</button>
            <button type="button" role="tab" aria-selected={tab === "usage"} data-active={tab === "usage"} className="model-usage-tab" onClick={() => setTab("usage")}>Consumo</button>
          </div>
          <div className="model-usage-mobile-body" role="tabpanel">
            {tab === "model" ? modelList : usageBody}
          </div>
        </div>
      ) : (
        <div className="model-usage-menu">
          <section className="model-usage-models">
            <p className="px-3 pb-1 pt-3 text-caption-2-semibold uppercase tracking-wide text-text-tertiary">Modelo</p>
            {modelList}
          </section>
          <section className="model-usage-body">{usageBody}</section>
        </div>
      )}
    </ComposerMenu>
  );
}
