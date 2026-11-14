import { useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, PlugZap, Save, Bot } from "@toph/icons";
import { api, type AIConfigInput } from "../../../shared/api";
import { useAI } from "../store";
import { useApp } from "../../../app/store";
import { Button } from "@toph/ui/app";
import { ProgressBar } from "@toph/ui/app";
import { Input } from "@toph/ui/app";
import { Textarea } from "@toph/ui/app";
import { Switch } from "@toph/ui/app";
import { Checkbox } from "@toph/ui/app";
import { Select, SelectItem } from "@toph/ui/app";
import ProviderModelPicker from "./ProviderModelPicker";
import { Chip } from "@toph/ui/app";

const providers = [
  { id: "openai", label: "OpenAI (Responses)", base: "https://api.openai.com", provider: "openai" },
  { id: "anthropic", label: "Anthropic", base: "https://api.anthropic.com", provider: "anthropic" },
  { id: "ollama", label: "Ollama", base: "http://127.0.0.1:11434", provider: "ollama" },
  { id: "opencode-go", label: "OpenCode Go", base: "https://opencode.ai/inference/go/openai/v1", provider: "custom" },
  { id: "custom", label: "URL personalizada (OpenAI compatível)", base: "", provider: "custom" },
] as const;

function connectionKind(provider: string, baseUrl: string): string {
  if (provider === "custom" && baseUrl.toLowerCase().includes("opencode.ai/inference/go")) return "opencode-go";
  return provider;
}

const empty: AIConfigInput = {
  label: "",
  provider: "",
  baseUrl: "",
  apiKey: "",
  clearKey: false,
  model: "",
  autocompleteModel: "",
  maxTokens: 4096,
  temperature: 0.2,
  autocomplete: false,
  systemPrompt: "",
};

export default function AiSettings() {
  const config = useAI((state) => state.config);
  const setConfig = useAI((state) => state.setConfig);
  const models = useAI((state) => state.models);
  const loadModels = useAI((state) => state.loadModels);
  const loadingModels = useAI((state) => state.loadingModels);
  const modelError = useAI((state) => state.error);
  const notify = useApp((state) => state.notify);
  const [form, setForm] = useState<AIConfigInput>(empty);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .aiConfig()
      .then((next) => {
        setConfig(next);
        void loadModels();
        setForm({
          label: next.label || next.connectionLabel || "",
          provider: next.provider,
          baseUrl: next.baseUrl,
          model: next.model,
          autocompleteModel: next.autocompleteModel,
          maxTokens: next.maxTokens,
          temperature: next.temperature,
          autocomplete: next.autocomplete,
          systemPrompt: next.systemPrompt,
          apiKey: "",
          clearKey: false,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load AI settings."));
  }, [setConfig]);

  function patch(next: Partial<AIConfigInput>) {
    setForm((current) => ({ ...current, ...next }));
    setTested(null);
  }

  function chooseProvider(kind: string) {
    const preset = providers.find((item) => item.id === kind);
    if (!preset) return;
    const keepCustom = preset.id === "custom" && !form.baseUrl.toLowerCase().includes("opencode.ai/inference/go");
    const current = form.label.trim();
    const isPresetLabel = providers.some((item) => item.label === current);
    patch({
      provider: preset.provider,
      label: preset.id === "custom" ? (isPresetLabel ? "" : current) : (isPresetLabel || !current ? preset.label : current),
      baseUrl: preset.id === "custom" ? (keepCustom ? form.baseUrl : "") : preset.base,
      model: "",
      autocompleteModel: "",
      autocomplete: form.autocomplete,
    });
  }

  async function save(event?: FormEvent, test = false) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveAIConfig(form);
      setConfig(saved);
      await loadModels();
      setForm((current) => ({ ...current, apiKey: "", clearKey: false }));
      notify("success", "AI settings saved.");
      if (test) {
        await api.testAI();
        setTested(true);
      } else {
        setTested(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save AI settings.";
      setError(message);
      setTested(false);
      if (test) notify("error", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="flex items-center gap-2 text-body-medium text-text-primary"><Bot size={16} /> Agente de IA</h3>
        <p className="mt-1 text-caption-1-regular text-text-secondary">
          O provider selecionado é usado pelo painel do agente e pelo autocomplete do editor.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <div className="bg-background-secondary-default flex flex-col gap-4 rounded-lg border p-4">
          <Input label="Nome da conexão" value={form.label} onChange={(label) => patch({ label })} placeholder="Ex.: OpenCode Go" />
          <div className="flex flex-col gap-1.5">
            <span className="text-body-medium text-text-secondary">Tipo de conexão</span>
            <Select selectedKey={connectionKind(form.provider, form.baseUrl)} onSelectionChange={(key) => chooseProvider(String(key))} aria-label="Tipo de conexão" className="w-full">
              {providers.map((provider) => (
                <SelectItem key={provider.id} id={provider.id}>{provider.label}</SelectItem>
              ))}
            </Select>
            {loadingModels && <ProgressBar size="sm" isIndeterminate label="Carregando modelos..." />}
          </div>
          <Input
            label="URL da API do provedor"
            value={form.baseUrl}
            onChange={(value) => patch({ baseUrl: value })}
            placeholder="https://api.example.com"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-body-medium text-text-secondary">Modelo</span>
            <ProviderModelPicker models={models} model={form.model} onChange={(value) => patch({ model: value })} placeholder="Escolha um modelo" disabled={loadingModels || models.length === 0} className="w-full" />
            <Input label="ID do modelo (também pode ser informado diretamente)" value={form.model} onChange={(model) => patch({ model })} />
            {modelError && <p role="alert" className="text-xs text-red-500">{modelError}</p>}
          </div>
          <Input
            label={config?.hasKey ? "API key (salva)" : "API key"}
            type="password"
            value={form.apiKey}
            onChange={(value) => patch({ apiKey: value })}
            placeholder={config?.hasKey ? "Deixe em branco para manter a chave atual" : "Chave do provedor (opcional para modelos locais)"}
            autoComplete="off"
          />
          {config?.hasKey && (
            <Checkbox isSelected={Boolean(form.clearKey)} onChange={(value) => patch({ clearKey: value })}>
              Remover chave salva
            </Checkbox>
          )}
        </div>

        <div className="bg-background-secondary-default grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <Input label="Max tokens" type="number" value={String(form.maxTokens)} onChange={(value) => patch({ maxTokens: Number(value) || 1 })} />
          <Input label="Temperature" type="number" value={String(form.temperature)} onChange={(value) => patch({ temperature: Number(value) || 0 })} />
          <div className="sm:col-span-2"><Textarea label="System prompt" rows={3} value={form.systemPrompt} onChange={(value) => patch({ systemPrompt: value })} /></div>
        </div>

        <div className="bg-background-secondary-default flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-body-medium text-text-primary">Autocomplete do editor</p>
              <p className="text-caption-1-regular text-text-secondary">Sugestões inline enquanto você digita.</p>
            </div>
            <Switch isSelected={form.autocomplete} onChange={(value) => patch({ autocomplete: value })} />
          </div>
          {form.autocomplete && (
            <div className="flex flex-col gap-1.5 border-t border-border-button-default pt-3">
              <span className="text-body-medium text-text-secondary">Modelo de autocomplete</span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button type="button" size="small" variant={form.autocompleteModel ? "ghost" : "secondary"} onClick={() => patch({ autocompleteModel: "" })}>Modelo principal</Button>
                <ProviderModelPicker models={models} model={form.autocompleteModel} onChange={(value) => patch({ autocompleteModel: value })} placeholder="Mesmo modelo principal" disabled={loadingModels || models.length === 0} className="w-full" />
              </div>
              <p className="text-caption-2-regular text-text-secondary">
                Selecione um modelo específico para autocomplete, ou use o modelo principal configurado.
              </p>
            </div>
          )}
        </div>

        {error && <Chip color="rose" variant="subtle" className="justify-start gap-2 whitespace-normal px-2 py-1.5"><CircleAlert size={13} /> {error}</Chip>}
        {tested !== null && (
          <Chip color={tested ? "lime" : "rose"} variant="subtle" className="justify-start gap-2 px-2 py-1.5">
            <Check size={13} /> {tested ? "Provider acessível." : "Falha ao testar o provider."}
          </Chip>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} leadingIcon={PlugZap} onClick={() => void save(undefined, true)}>Salvar e testar</Button>
          <Button type="submit" disabled={busy} leadingIcon={Save}>{busy ? "Salvando..." : "Salvar configurações"}</Button>
        </div>
      </form>
    </div>
  );
}
