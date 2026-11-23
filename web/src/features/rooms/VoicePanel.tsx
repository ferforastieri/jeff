import { useEffect, useRef, useState } from "react";
import { LogOut, Mic, Play, Settings2, Square } from "@jeff/icons";
import { api, type Project, type VoiceParticipant } from "../../shared/api";
import type { Room } from "./api";

const field =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";
const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";

async function makeOffer(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const done = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", done);
    window.setTimeout(resolve, 3000);
  });
  return pc.localDescription?.sdp ?? offer.sdp ?? "";
}

interface Props {
  project: Project;
  room: Room;
  meId: string | null;
}

export default function VoicePanel({ project, room, meId }: Props) {
  const [config, setConfig] = useState<{ appId: string; configured: boolean } | null | "forbidden">(
    null,
  );
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<{ id: string; stream: MediaStream }[]>([]);
  const [error, setError] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const audios = useRef<HTMLAudioElement[]>([]);
  const remoteKeys = useRef<Set<string>>(new Set());
  const syncing = useRef<Promise<void>>(Promise.resolve());
  const leaveRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    void api
      .voiceConfig()
      .then((value) => {
        setConfig(value);
        setAppId(value.appId);
      })
      .catch((cause) => {
        if (cause instanceof Error && "status" in cause && (cause as { status: number }).status === 403) {
          setConfig("forbidden");
        } else {
          setError(cause instanceof Error ? cause.message : "Não foi possível ler a configuração de voz.");
        }
      });
  }, []);

  useEffect(() => {
    if (!joined) return;
    const timer = window.setInterval(() => {
      void refreshParticipants().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, project.id, room.id]);

  useEffect(() => {
    return () => {
      void leaveRef.current();
    };
  }, []);

  async function refreshParticipants() {
    const result = await api.voiceParticipants(project.id, room.id);
    setParticipants(result.participants);
    scheduleSync(result.participants);
  }

  function scheduleSync(list: VoiceParticipant[]) {
    syncing.current = syncing.current
      .then(() => syncSubscriptions(list))
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Não foi possível ouvir um participante.");
      });
  }

  async function syncSubscriptions(list: VoiceParticipant[]) {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") return;
    const pending: {
      transceiver: RTCRtpTransceiver;
      key: string;
      sessionId: string;
      trackName: string;
    }[] = [];
    for (const participant of list) {
      if (participant.principalId === meId) continue;
      for (const trackName of participant.tracks) {
        const key = `${participant.sessionId}:${trackName}`;
        if (remoteKeys.current.has(key)) continue;
        const transceiver = pc.addTransceiver(trackName === "screen" ? "video" : "audio", {
          direction: "recvonly",
        });
        pending.push({ transceiver, key, sessionId: participant.sessionId, trackName });
        remoteKeys.current.add(key);
      }
    }
    if (pending.length === 0) return;
    const sdp = await makeOffer(pc);
    const answer = await api.voiceExchange(project.id, room.id, {
      sdp,
      subscribe: pending.map((item) => ({
        mid: item.transceiver.mid ?? "",
        sessionId: item.sessionId,
        trackName: item.trackName,
      })),
    });
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  }

  async function join() {
    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não suporta voz.");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localRef.current = stream;
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (event) => {
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === "video") {
          setRemoteStreams((current) => [
            ...current.filter((item) => item.stream.id !== remote.id),
            { id: remote.id, stream: remote },
          ]);
        } else {
          const audio = new Audio();
          audio.srcObject = remote;
          audio.autoplay = true;
          audios.current.push(audio);
          void audio.play().catch(() => undefined);
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") setError("A conexão de voz caiu.");
      };
      const transceiver = pc.addTransceiver(stream.getAudioTracks()[0], {
        direction: "sendonly",
      });
      const sdp = await makeOffer(pc);
      const result = await api.voiceJoin(project.id, room.id, {
        sdp,
        tracks: [{ mid: transceiver.mid ?? "0", trackName: "audio" }],
      });
      await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
      setJoined(true);
      await refreshParticipants();
    } catch (cause) {
      cleanupLocal();
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar na voz.");
    } finally {
      setConnecting(false);
    }
  }

  function cleanupLocal() {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    audios.current.forEach((audio) => {
      audio.srcObject = null;
    });
    audios.current = [];
    remoteKeys.current.clear();
    setRemoteStreams([]);
    setParticipants([]);
    setJoined(false);
    setMuted(false);
    setSharing(false);
  }

  async function leave() {
    cleanupLocal();
    await api.voiceLeave(project.id, room.id).catch(() => undefined);
  }
  leaveRef.current = leave;

  function toggleMute() {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = muted;
    setMuted(!muted);
  }

  async function share() {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenRef.current = display;
      const track = display.getVideoTracks()[0];
      track.onended = () => setSharing(false);
      const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
      const sdp = await makeOffer(pc);
      const answer = await api.voiceExchange(project.id, room.id, {
        sdp,
        publish: [{ mid: transceiver.mid ?? "0", trackName: "screen" }],
      });
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      setSharing(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível compartilhar a tela.");
    }
  }

  function stopShare() {
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setSharing(false);
  }

  async function saveConfig() {
    if (!appId.trim()) return;
    try {
      const value = await api.saveVoiceConfig(appId.trim(), secret.trim());
      setConfig(value);
      setSecret("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    }
  }

  if (!config) {
    return (
      <div className="flex flex-1 items-center justify-center text-caption-1-regular text-text-tertiary">
        lendo a configuração de voz…
      </div>
    );
  }

  if (config === "forbidden" || !config.configured) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Settings2 size={22} className="text-text-tertiary" />
        <h2 className="text-body-1-medium">Voz ainda não configurada</h2>
        <p className="max-w-md text-caption-1-regular text-text-tertiary">
          {config === "forbidden"
            ? "Peça ao admin para configurar o Cloudflare Realtime nas configurações de voz."
            : "Informe o App ID e o secret do Cloudflare Realtime. Sem credencial, o áudio não tem para onde ir."}
        </p>
        {config === "forbidden" ? null : (
          <div className="mt-2 w-full max-w-sm space-y-2 text-left">
            <input
              className={field}
              placeholder="App ID"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
            />
            <input
              className={field}
              type="password"
              placeholder="App secret"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
            <button className={primaryButton} onClick={() => void saveConfig()}>
              salvar credencial
            </button>
          </div>
        )}
        {error ? <p className="text-caption-1-regular text-red-500">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-1-medium">Voz · {room.name}</h2>
          <p className="text-caption-1-regular text-text-tertiary">
            {joined
              ? `${participants.length} na sala · você está ao vivo`
              : "entre para falar com as pessoas da sala"}
          </p>
        </div>
        {joined ? (
          <>
            <button className={quietButton} onClick={toggleMute}>
              <Mic size={14} /> {muted ? "mudo" : "mic"}
            </button>
            {sharing ? (
              <button className={quietButton} onClick={stopShare}>
                <Square size={14} /> parar tela
              </button>
            ) : (
              <button className={quietButton} onClick={() => void share()}>
                <Play size={14} /> compartilhar
              </button>
            )}
            <button className={quietButton} onClick={() => void leave()}>
              <LogOut size={14} /> sair
            </button>
          </>
        ) : (
          <button className={primaryButton} onClick={() => void join()} disabled={connecting}>
            {connecting ? "entrando…" : "entrar na voz"}
          </button>
        )}
      </header>

      {error ? (
        <p className="border-b border-separator-border px-4 py-2 text-caption-2-regular text-red-500">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-2">
          {participants.map((participant) => (
            <span
              key={participant.principalId}
              className="inline-flex items-center gap-2 rounded-full border border-separator-border bg-background-secondary-default px-3 py-1.5 text-caption-1-regular"
            >
              <Mic size={12} className="text-accent-500" />
              {participant.name}
              {participant.principalId === meId ? " (você)" : ""}
            </span>
          ))}
          {participants.length === 0 ? (
            <p className="text-caption-1-regular text-text-tertiary">Ninguém na voz ainda.</p>
          ) : null}
        </div>

        {remoteStreams.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {remoteStreams.map((item) => (
              <video
                key={item.id}
                autoPlay
                playsInline
                className="w-full rounded-xl border border-separator-border bg-black"
                ref={(element) => {
                  if (element && element.srcObject !== item.stream) element.srcObject = item.stream;
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
