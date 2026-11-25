import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "@jeff/icons";
import type { AIModel } from "../../shared/api";
import { engineApi } from "../agents/api";
import { roomsApi, type Principal } from "../rooms/api";
import { findModel, modelBrand, modelSelectOptions } from "../providers/store";
import ProviderIcon from "../providers/components/ProviderIcon";
import { cx } from "@jeff/ui";

interface Props {
  agent: Principal;
  models: AIModel[];
  onUpdated: (agent: Principal) => void;
  onConnect: () => void;
}

const WINDOWS = ["rolling", "weekly", "monthly"] as const;
const WINDOW_LABEL = { rolling: "5 horas", weekly: "Semanal", monthly: "Mensal" } as const;

/** The agent's model, effort and plan usage, in the workspace composer. */
export default function AgentComposerControls({ agent, models, onUpdated, onConnect }: Props) {
  const bot = agent.bot ?? {};
  const found = findModel(models, bot.model ?? "");
  const engine = found?.engine || bot.engine || "opencode";
  const model = bot.model ?? "";
  const effort = bot.effort ?? "";
  const variants = found?.variants?.length ? found.variants : [];
  const brand = modelBrand({ id: model, label: found?.label, provider: found?.provider, connectionLabel: found?.connectionLabel });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [used, setUsed] = useState<number | null>(null);
  const [usageTitle, setUsageTitle] = useState("");

  const options = useMemo(() => {
    const list = modelSelectOptions(models);
    if (model && !list.some((option) => option.value === model)) {
      list.unshift({ value: model, label: model });
    }
    return list;
  }, [model, models]);

  useEffect(() => {
    if (engine !== "opencode") {
      setUsed(null);
      setUsageTitle("");
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await engineApi.limits(engine);
        if (cancelled || !result.ok || !result.data?.go) return;
        const go = result.data.go;
        const entries = WINDOWS.map((key) => ({ key, window: go[key] })).filter(
          (entry): entry is { key: (typeof WINDOWS)[number]; window: NonNullable<typeof entry.window> } => Boolean(entry.window),
        );
        if (entries.length === 0) return;
        const percent = (window: (typeof entries)[number]["window"]) => window.limited ? 100 : Math.round(window.percent);
        setUsed(Math.max(...entries.map((entry) => percent(entry.window))));
        setUsageTitle(entries.map((entry) => `${WINDOW_LABEL[entry.key]}: ${percent(entry.window)}%`).join(" · "));
      } catch {
        // The plan usage is informative; the composer keeps working without it.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [engine]);

  async function update(patch: { model?: string; effort?: string }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const nextModel = patch.model ?? model;
      const nextFound = models.find((item) => item.id === nextModel);
      const nextEngine = nextFound?.engine || bot.engine || "opencode";
      const nextVariants = nextFound?.variants ?? [];
      const nextEffort = patch.effort !== undefined
        ? patch.effort
        : nextVariants.includes(effort) ? effort : "";
      const updated = await roomsApi.updateBot(agent.id, {
        name: agent.name,
        handle: agent.handle,
        title: bot.title ?? "",
        persona: bot.persona ?? "",
        engine: nextEngine,
        model: nextModel,
        effort: nextEffort,
      });
      onUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo.");
    } finally {
      setBusy(false);
    }
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="ac-composer__pill" onClick={onConnect}>
          Conectar IA
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <label className={cx("ac-composer__pill", busy && "opacity-60")} title="Modelo deste agente">
        <ProviderIcon provider={brand} className="size-3.5 shrink-0" />
        <select
          className="ws-agent-select"
          value={model}
          disabled={busy}
          onChange={(event) => void update({ model: event.target.value })}
          aria-label="Modelo do agente"
        >
          <option value="">Modelo padrão</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
      </label>

      {variants.length > 0 ? (
        <label className={cx("ac-composer__pill", busy && "opacity-60")} title="Esforço de raciocínio">
          <select
            className="ws-agent-select"
            value={effort}
            disabled={busy}
            onChange={(event) => void update({ effort: event.target.value })}
            aria-label="Esforço do agente"
          >
            <option value="">Esforço padrão</option>
            {variants.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
        </label>
      ) : null}

      {used != null ? (
        <span className="ac-composer__pill" title={usageTitle || "Consumo do plano"}>
          Uso {used}%
        </span>
      ) : null}

      {error ? <span className="text-caption-2-regular text-status-rose-text">{error}</span> : null}
    </div>
  );
}
