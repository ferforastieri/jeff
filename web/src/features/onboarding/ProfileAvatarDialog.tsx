import { useEffect, useState } from "react";
import { Button } from "faang-ui/components/Button";
import { Dialog, DialogBody, DialogFooter } from "faang-ui/components/Dialog";
import { Segmented } from "faang-ui/components/Segmented";
import { TabPanel, Tabs } from "faang-ui/components/Tabs";
import {
  Icon,
  PERSON_CATALOG,
  PERSON_DEFAULT,
  PERSON_FIELDS,
  personSwatchOf,
  randomPerson,
  type PersonBuild,
  type PersonField,
  type PersonRecipe,
} from "faang-ui";
import { PersonFace } from "./PersonFace";

type AvatarTab = "face" | "hair" | "beard" | "marks" | "accessories" | "clothes" | "bg";

const TABS: { value: AvatarTab; label: string }[] = [
  { value: "face", label: "Rosto" },
  { value: "hair", label: "Cabelo" },
  { value: "beard", label: "Barba" },
  { value: "marks", label: "Marcas" },
  { value: "accessories", label: "Acessórios" },
  { value: "clothes", label: "Roupa" },
  { value: "bg", label: "Fundo" },
];

const TAB_FIELDS: Record<AvatarTab, PersonField[]> = {
  face: ["skin", "eyes", "lips", "mood"],
  hair: ["hair", "hairColor"],
  beard: ["beard"],
  marks: ["mark", "blush", "shadow"],
  accessories: ["glasses", "extra", "ear", "neck"],
  clothes: ["clothes", "clothesColor"],
  bg: ["bg"],
};

const FIELD_LABELS: Partial<Record<PersonField, string>> = {
  skin: "Tom de pele",
  eyes: "Cor dos olhos",
  lips: "Lábios",
  mood: "Expressão",
  hair: "Cabelo",
  hairColor: "Cor do cabelo",
  beard: "Barba",
  mark: "Marcas",
  blush: "Bochechas",
  shadow: "Sombras",
  glasses: "Óculos",
  extra: "Acessório",
  ear: "Orelhas",
  neck: "Pescoço",
  clothes: "Roupa",
  clothesColor: "Cor da roupa",
  bg: "Fundo",
};

function labelOf(value: string) {
  if (value === "none") return "Nenhum";
  const spaced = value.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function optionsFor(recipe: PersonRecipe, field: PersonField) {
  return PERSON_CATALOG[recipe.build]?.[field] ?? PERSON_FIELDS[field];
}

interface Props {
  open: boolean;
  current?: PersonRecipe | null;
  onClose: () => void;
  onSave: (recipe: PersonRecipe) => void;
  onPhoto: () => void;
}

export function ProfileAvatarDialog({ open, current, onClose, onSave, onPhoto }: Props) {
  const [recipe, setRecipe] = useState<PersonRecipe>(current ?? PERSON_DEFAULT);
  const [tab, setTab] = useState<AvatarTab>("face");

  useEffect(() => {
    if (open) {
      setRecipe(current ?? randomPerson("jeff-profile"));
      setTab("face");
    }
  }, [open, current]);

  function patch(field: PersonField, value: string) {
    setRecipe((previous) => ({ ...previous, [field]: value }) as PersonRecipe);
  }

  function setBuild(build: PersonBuild) {
    setRecipe((previous) => {
      const next = { ...previous, build };
      const values = next as unknown as Record<string, string>;
      for (const field of Object.keys(PERSON_FIELDS) as PersonField[]) {
        if (field === "build") continue;
        const allowed = optionsFor(next, field);
        if (!allowed.includes(values[field])) values[field] = allowed[0] ?? values[field];
      }
      return next;
    });
  }

  function randomize() {
    setRecipe(randomPerson(Date.now(), recipe.build));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Seu avatar"
      description="Monte seu retrato. Ele aparece no chat e nos cards do time."
      closeLabel="Fechar"
      width={760}
    >
      <DialogBody className="jeff-avatar-dialog">
        <section className="jeff-avatar-preview">
          <div className="jeff-avatar-preview__portrait">
            <PersonFace recipe={recipe} crop="full" />
          </div>
          <Segmented
            value={recipe.build}
            onValueChange={(value) => setBuild(value as PersonBuild)}
            options={[
              { value: "m", label: "Masculino" },
              { value: "f", label: "Feminino" },
            ]}
            label="Gênero"
            size="sm"
            block
          />
          <Button variant="default" size="sm" icon="shuffle" onClick={randomize}>
            Sortear
          </Button>
          <div className="jeff-avatar-sizes">
            {[64, 36, 24].map((size) => (
              <span key={size} style={{ width: size, height: size }} className="jeff-avatar-size">
                <PersonFace recipe={recipe} />
              </span>
            ))}
          </div>
          <p className="jeff-avatar-preview__note">
            Nos tamanhos pequenos do chat aparece só o rosto.
          </p>
        </section>

        <section className="jeff-avatar-editor">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as AvatarTab)}
            items={TABS}
            label="Partes do avatar"
          >
            {TABS.map((item) => (
              <TabPanel key={item.value} value={item.value}>
                <div className="jeff-avatar-fields">
                  {TAB_FIELDS[item.value].map((field) => {
                    const options = optionsFor(recipe, field);
                    return (
                      <div className="jeff-avatar-field" key={field}>
                        <span className="jeff-avatar-field__label">{FIELD_LABELS[field] ?? field}</span>
                        <div className="jeff-avatar-options">
                          {options.map((value) => {
                            const selected = recipe[field] === value;
                            const swatch = personSwatchOf(field, value);
                            if (swatch) {
                              return (
                                <Button
                                  key={value}
                                  variant="default"
                                  size="sm"
                                  className="jeff-avatar-swatch"
                                  aria-label={`${FIELD_LABELS[field] ?? field}: ${labelOf(value)}`}
                                  aria-pressed={selected}
                                  onClick={() => patch(field, value)}
                                >
                                  <span
                                    className="jeff-avatar-swatch__dot"
                                    style={{ background: swatch }}
                                  />
                                </Button>
                              );
                            }
                            return (
                              <Button
                                key={value}
                                variant="default"
                                size="sm"
                                className="jeff-avatar-option"
                                aria-label={`${FIELD_LABELS[field] ?? field}: ${labelOf(value)}`}
                                aria-pressed={selected}
                                onClick={() => patch(field, value)}
                              >
                                <span className="jeff-avatar-option__preview">
                                  <PersonFace
                                    recipe={{ ...recipe, [field]: value }}
                                    crop={item.value === "clothes" ? "full" : "face"}
                                  />
                                </span>
                                <span className="jeff-avatar-option__label">{labelOf(value)}</span>
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabPanel>
            ))}
          </Tabs>
          {colorHint(tab)}
        </section>
      </DialogBody>
      <DialogFooter
        note={
          <Button variant="link" onClick={onPhoto}>
            Prefere uma foto? Enviar foto
          </Button>
        }
      >
        <Button variant="default" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            onSave(recipe);
            onClose();
          }}
        >
          Salvar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function colorHint(tab: AvatarTab) {
  if (tab === "bg") {
    return (
      <p className="jeff-avatar-hint">
        <Icon name="info" size={14} /> O fundo aparece atrás do retrato no chat.
      </p>
    );
  }
  return null;
}
