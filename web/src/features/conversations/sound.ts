import {
  DEFAULT_SOUND_STYLE,
  isSoundStyle,
  renderSound,
  SAMPLE_RATE,
  type SoundName,
  type SoundStyle,
} from "@jeff/ui/sfx/synth";

/**
 * The app's notification sounds, synthesized by the old Jeff kit: three
 * styles (wood, glass and a soft 8-bit chip) or off. The choice belongs to
 * this device, like the theme.
 */
export type SoundChoice = SoundStyle | "off";

const STORAGE_KEY = "jeff_sound_style";
const CHANGE_EVENT = "jeff:sound-choice";
const QUESTION_KEY = "jeff_question_sound";
const QUESTION_EVENT = "jeff:question-sound";

/** The old kit's short sounds a question can use. */
export const QUESTION_SOUNDS = [
  "attention",
  "mention",
  "reply",
  "done",
  "approved",
  "error",
  "stop",
  "send",
] as const satisfies readonly SoundName[];
export type QuestionSound = (typeof QUESTION_SOUNDS)[number];
export const DEFAULT_QUESTION_SOUND: QuestionSound = "attention";

function isQuestionSound(value: unknown): value is QuestionSound {
  return typeof value === "string" && (QUESTION_SOUNDS as readonly string[]).includes(value);
}
/** A cue under the conversation, never over it. */
const VOLUME = 0.35;
/** The same sound twice this close is one (a burst of events). */
const REPEAT_MS = 150;

function read(): SoundChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "off" || isSoundStyle(saved) ? saved : DEFAULT_SOUND_STYLE;
  } catch {
    return DEFAULT_SOUND_STYLE;
  }
}

let choice: SoundChoice = read();

function readQuestionSound(): QuestionSound {
  try {
    const saved = localStorage.getItem(QUESTION_KEY);
    return isQuestionSound(saved) ? saved : DEFAULT_QUESTION_SOUND;
  } catch {
    return DEFAULT_QUESTION_SOUND;
  }
}

let question: QuestionSound = readQuestionSound();

export function soundChoice(): SoundChoice {
  return choice;
}

export function questionSound(): QuestionSound {
  return question;
}

export function onSoundChoiceChange(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function onQuestionSoundChange(callback: () => void): () => void {
  window.addEventListener(QUESTION_EVENT, callback);
  return () => window.removeEventListener(QUESTION_EVENT, callback);
}

/** Saves the choice and plays a sample of the new style. */
export function setSoundChoice(next: SoundChoice): void {
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable; the choice still lives for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  play("mention");
}

/** Saves the question sound and plays a sample of it. */
export function setQuestionSound(next: QuestionSound): void {
  question = next;
  try {
    localStorage.setItem(QUESTION_KEY, next);
  } catch {
    // Storage can be unavailable; the choice still lives for this session.
  }
  window.dispatchEvent(new Event(QUESTION_EVENT));
  play(next);
}

let context: AudioContext | null = null;
let output: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const lastPlayed = new Map<SoundName, number>();

function audio(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  output = context.createGain();
  output.gain.value = VOLUME;
  output.connect(context.destination);
  return context;
}

/** Create/resume the audio context during a user gesture so later sounds can play. */
export function unlockBotSound(): void {
  const current = audio();
  if (current?.state === "suspended") void current.resume().catch(() => undefined);
}

function buffer(current: AudioContext, style: SoundStyle, name: SoundName): AudioBuffer {
  const key = `${style}/${name}`;
  let result = buffers.get(key);
  if (!result) {
    const samples = renderSound(style, name);
    result = current.createBuffer(1, samples.length, SAMPLE_RATE);
    result.getChannelData(0).set(samples);
    buffers.set(key, result);
  }
  return result;
}

function play(name: SoundName): void {
  if (choice === "off") return;
  const current = audio();
  if (!current || !output) return;
  const start = () => {
    const now = performance.now();
    if (now - (lastPlayed.get(name) ?? -Infinity) < REPEAT_MS) return;
    lastPlayed.set(name, now);
    const source = current.createBufferSource();
    source.buffer = buffer(current, choice as SoundStyle, name);
    source.connect(output!);
    source.start();
  };
  if (current.state === "suspended") {
    void current.resume().then(() => {
      if (current.state === "running") start();
    }).catch(() => undefined);
    return;
  }
  if (current.state === "running") start();
}

/** Short signal used when a Jeff finishes a response. */
export function playBotResponseSound(): void {
  play("reply");
}

/** Attention signal used when the Jeff is waiting for an answer. */
export function playQuestionSound(): void {
  play(question);
}
