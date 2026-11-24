import { useSyncExternalStore } from "react";
import { Segmented } from "@jeff/ui";
import { Select, SelectItem } from "@jeff/ui/app";
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

const SOUND_OPTIONS: Array<{ value: SoundChoice; label: string; title: string }> = [
  { value: "tactile", label: "Tátil", title: "Madeira: um toque curto e seco" },
  { value: "sky", label: "Céu", title: "Vidro: notas claras com uma sala curta" },
  { value: "pixel", label: "Pixel", title: "Chip: um bipe suave de 8 bits" },
  { value: "off", label: "Desligado", title: "Sem som neste dispositivo" },
];

/** The compact sound panel inside the notifications popover. */
export default function NotificationSoundSettings() {
  const sounds = useSyncExternalStore(onSoundChoiceChange, soundChoice, soundChoice);
  const question = useSyncExternalStore(onQuestionSoundChange, questionSound, questionSound);

  return (
    <div className="notification-sound">
      <section className="notification-sound__group">
        <div className="notification-sound__copy">
          <strong>Estilo</strong>
          <small>Ao trocar, toca uma amostra do novo som.</small>
        </div>
        <div className="notification-sound__control">
          <Segmented
            size="sm"
            label="Estilo do som das notificações"
            value={sounds}
            onValueChange={(value) => setSoundChoice(value as SoundChoice)}
            options={SOUND_OPTIONS}
          />
        </div>
      </section>

      <section className="notification-sound__group">
        <div className="notification-sound__copy">
          <strong>Som da pergunta</strong>
          <small>Toca quando o Jeff pede uma resposta; usa o estilo escolhido acima.</small>
        </div>
        <div className="notification-sound__control">
          <Select
            selectedKey={question}
            onSelectionChange={(key) => setQuestionSound(String(key) as QuestionSound)}
            aria-label="Som da pergunta"
          >
            {QUESTION_OPTIONS.map((option) => (
              <SelectItem key={option.value} id={option.value}>{option.label}</SelectItem>
            ))}
          </Select>
        </div>
      </section>
    </div>
  );
}
