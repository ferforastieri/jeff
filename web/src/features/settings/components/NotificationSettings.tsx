import { useSyncExternalStore } from "react";
import { Card, CardHeader, Icon, Segmented } from "@jeff/ui";
import {
  onQuestionSoundChange,
  onSoundChoiceChange,
  questionSound,
  setQuestionSound,
  setSoundChoice,
  soundChoice,
  type QuestionSound,
  type SoundChoice,
} from "../../conversations/sound";
import { Select, SelectItem } from "@jeff/ui/app";

const QUESTION_OPTIONS: Array<{ value: QuestionSound; label: string }> = [
  { value: "attention", label: "Atenção" },
  { value: "mention", label: "Menção" },
  { value: "reply", label: "Resposta" },
  { value: "done", label: "Concluído" },
  { value: "approved", label: "Aprovado" },
  { value: "error", label: "Erro" },
  { value: "stop", label: "Parar" },
  { value: "send", label: "Enviar" },
];

const OPTIONS: Array<{ value: SoundChoice; label: string; title: string }> = [
  { value: "tactile", label: "Tátil", title: "Madeira: um toque curto e seco" },
  { value: "sky", label: "Céu", title: "Vidro: notas claras com uma sala curta" },
  { value: "pixel", label: "Pixel", title: "Chip: um bipe suave de 8 bits" },
  { value: "off", label: "Desligado", title: "Sem som neste dispositivo" },
];

/** The sound style for this device: the old Jeff kit's three voices or silence. */
export default function NotificationSettings() {
  const sounds = useSyncExternalStore(onSoundChoiceChange, soundChoice, soundChoice);
  const question = useSyncExternalStore(onQuestionSoundChange, questionSound, questionSound);

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
        <div className="settings-row ac-actrow settings-row--lead">
          <span className="settings-row__icon" aria-hidden="true"><Icon name="question" size={16} /></span>
          <span className="settings-row__text ac-actrow__text">
            <span className="settings-row__label">Som da pergunta</span>
            <span className="settings-row__status">Toca quando o Jeff pede uma resposta; usa o estilo escolhido acima.</span>
          </span>
          <span className="settings-row__control">
            <Select
              selectedKey={question}
              onSelectionChange={(key) => setQuestionSound(String(key) as QuestionSound)}
              aria-label="Som da pergunta"
            >
              {QUESTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} id={option.value}>{option.label}</SelectItem>
              ))}
            </Select>
          </span>
        </div>
      </div>
    </Card>
  );
}
