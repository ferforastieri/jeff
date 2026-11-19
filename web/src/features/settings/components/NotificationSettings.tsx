import { useSyncExternalStore } from "react";
import { Card, CardHeader, Icon, Segmented } from "@jeff/ui";
import {
  onSoundChoiceChange,
  setSoundChoice,
  soundChoice,
  type SoundChoice,
} from "../../conversations/sound";

const OPTIONS: Array<{ value: SoundChoice; label: string; title: string }> = [
  { value: "tactile", label: "Tátil", title: "Madeira: um toque curto e seco" },
  { value: "sky", label: "Céu", title: "Vidro: notas claras com uma sala curta" },
  { value: "pixel", label: "Pixel", title: "Chip: um bipe suave de 8 bits" },
  { value: "off", label: "Desligado", title: "Sem som neste dispositivo" },
];

/** The sound style for this device: the old Jeff kit's three voices or silence. */
export default function NotificationSettings() {
  const sounds = useSyncExternalStore(onSoundChoiceChange, soundChoice, soundChoice);

  return (
    <Card>
      <CardHeader
        icon="sound"
        title="Som das notificações"
        subtitle="Toca quando um Jeff termina uma resposta ou pede a sua resposta. A escolha vale para este dispositivo."
      />
      <div className="settings-rows">
        <div className="settings-row ac-actrow settings-row--lead">
          <span className="settings-row__icon" aria-hidden="true"><Icon name="sound" size={16} /></span>
          <span className="settings-row__text ac-actrow__text">
            <span className="settings-row__label">Estilo</span>
            <span className="settings-row__status">Ao trocar, toca uma amostra do novo som.</span>
          </span>
          <span className="settings-row__control">
            <Segmented
              size="sm"
              label="Estilo do som das notificações"
              value={sounds}
              onValueChange={(value) => setSoundChoice(value as SoundChoice)}
              options={OPTIONS}
            />
          </span>
        </div>
      </div>
    </Card>
  );
}
