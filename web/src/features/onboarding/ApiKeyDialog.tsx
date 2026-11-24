import { useEffect, useState } from "react";
import { Button } from "faang-ui/components/Button";
import { Dialog, DialogBody, DialogFooter } from "faang-ui/components/Dialog";
import { Field, Input } from "faang-ui/components/Field";
import { Select } from "faang-ui/components/Select";
import { Icon, ProviderLogo } from "faang-ui";
import { api } from "../../shared/api";

type ProviderKey = "anthropic" | "openai" | "custom";

const PRESETS: Record<
  ProviderKey,
  { label: string; baseUrl: string; site: string; placeholder: string }
> = {
  anthropic: {
    label: "Claude",
    baseUrl: "https://api.anthropic.com",
    site: "https://platform.claude.com",
    placeholder: "sk-ant-…",
  },
  openai: {
    label: "ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    site: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  custom: {
    label: "Outro provedor",
    baseUrl: "https://openrouter.ai/api/v1",
    site: "https://openrouter.ai/keys",
    placeholder: "sk-or-…",
  },
};

interface Props {
  open: boolean;
  provider?: ProviderKey;
  onClose: () => void;
  onSaved: (provider: string) => void;
}

export function ApiKeyDialog({ open, provider = "anthropic", onClose, onSaved }: Props) {
  const [choice, setChoice] = useState<ProviderKey>(provider);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setChoice(provider);
    setKey("");
    setError("");
    setBusy(false);
  }, [open, provider]);

  const preset = PRESETS[choice];

  async function save() {
    if (!key.trim()) {
      setError("Cole a chave de API.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const current = await api.aiConfig();
      await api.saveAIConfig({
        label: current.label || preset.label,
        provider: choice,
        baseUrl: preset.baseUrl,
        apiKey: key.trim(),
        clearKey: false,
        model: current.model,
        autocompleteModel: current.autocompleteModel,
        maxTokens: current.maxTokens,
        temperature: current.temperature,
        autocomplete: current.autocomplete,
        systemPrompt: current.systemPrompt,
      });
      onSaved(preset.label);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a chave.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Adicionar uma chave de API"
      closeLabel="Fechar"
      width={440}
    >
      <DialogBody className="jeff-api-key">
        <Select
          value={choice}
          onValueChange={(value) => setChoice(value as ProviderKey)}
          options={[
            {
              value: "anthropic",
              label: "Claude",
              leading: <ProviderLogo id="anthropic" size="xs" />,
            },
            {
              value: "openai",
              label: "ChatGPT",
              leading: <ProviderLogo id="openai" size="xs" />,
            },
            {
              value: "custom",
              label: "Outro provedor",
              leading: <Icon name="key" size={14} />,
            },
          ]}
          aria-label="Provedor da chave"
        />

        <p className="jeff-api-key__note">Você paga pelo uso, direto ao provedor.</p>

        <div className="jeff-api-key__step">
          <span className="jeff-api-key__number">1</span>
          <div>
            <strong>Crie sua chave de API {preset.label}</strong>
            {preset.site ? (
              <Button
                variant="default"
                size="sm"
                icon="external"
                className="jeff-api-key__external"
                onClick={() => window.open(preset.site, "_blank", "noopener,noreferrer")}
              >
                Abrir {preset.site.replace(/^https?:\/\//, "")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="jeff-api-key__step">
          <span className="jeff-api-key__number">2</span>
          <Field label="Cole aqui">
            <Input
              type="password"
              autoComplete="off"
              placeholder={preset.placeholder}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
            />
          </Field>
        </div>

        <p className="jeff-api-key__footer">
          <Icon name="info" size={14} /> Todo agente sem plano pensa com ela.
        </p>
        {error ? <p className="jeff-server__error">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="default" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>
          Salvar chave
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
