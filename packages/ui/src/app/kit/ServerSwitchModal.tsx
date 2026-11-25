import { useEffect, useState, type FormEvent } from "react";
import { Database, RefreshCw, Server, X } from "@jeff/icons";
import { Button } from "./Button";
import { Card } from "./Card";
import { Input } from "./Input";
import { Modal } from "./Modal";

export interface ServerSwitchModalProps {
  open: boolean;
  currentUrl: string;
  srcFor: (name: string) => string;
  onClose: () => void;
  onConnect: (url: string) => Promise<void> | void;
}

/** The server picker used by every screen that can change the Jeff server. */
export function ServerSwitchModal({
  open,
  currentUrl,
  srcFor,
  onClose,
  onConnect,
}: ServerSwitchModalProps) {
  const [url, setUrl] = useState(currentUrl);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(currentUrl);
      setError("");
      setBusy(false);
    }
  }, [open, currentUrl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onConnect(url);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível conectar ao servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="jeff-server-title">
      <div className="jeff-server__hero">
        <span className="jeff-server__orb jeff-server__orb--one" />
        <span className="jeff-server__orb jeff-server__orb--two" />
        <img
          src={srcFor("jeff-07")}
          alt=""
          draggable={false}
          className="jeff-server__jeff jeff-server__jeff--one"
          style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.28))" }}
        />
        <img
          src={srcFor("jeff-comet")}
          alt=""
          draggable={false}
          className="jeff-server__jeff jeff-server__jeff--two"
          style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.28))" }}
        />
        <img
          src={srcFor("jeff-bloom")}
          alt=""
          draggable={false}
          className="jeff-server__jeff jeff-server__jeff--three"
          style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.28))" }}
        />
        <Button
          variant="raw"
          type="button"
          className="jeff-server__close"
          aria-label="Fechar"
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </div>

      <div className="jeff-server__body">
        <h2 className="jeff-server__title" id="jeff-server-title">
          Onde fica o seu workspace?
        </h2>

        <Card selected className="jeff-server__option">
          <div className="jeff-server__option-head">
            <span className="jeff-server__option-title">No seu servidor</span>
            <span className="jeff-server__badge">Grátis · código aberto</span>
          </div>
          <ul className="jeff-server__features">
            <li>
              <Server size={14} />
              <span>Você cuida do servidor e dos backups</span>
            </li>
            <li>
              <RefreshCw size={14} />
              <span>Atualizações e backups ficam com você</span>
            </li>
            <li>
              <Database size={14} />
              <span>Os agentes param quando ele desliga</span>
            </li>
          </ul>
          <p className="jeff-server__note">Grátis para sempre, licença AGPL.</p>
        </Card>

        <form className="jeff-server__form" onSubmit={submit} noValidate>
          <label className="jeff-server__label" htmlFor="jeff-server-url">
            Endereço do servidor
          </label>
          <Input
            id="jeff-server-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://jeff.seudominio.com"
            autoComplete="url"
            spellCheck={false}
            autoFocus
          />
          {error ? (
            <p className="jeff-server__error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="light" block disabled={busy || !url.trim()}>
            {busy ? "Conectando..." : "Conectar"}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
