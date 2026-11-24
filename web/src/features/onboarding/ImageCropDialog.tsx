import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "faang-ui/components/Button";
import { Dialog, DialogBody, DialogFooter } from "faang-ui/components/Dialog";
import { FileUpload } from "faang-ui/components/FileUpload";

interface Props {
  open: boolean;
  title: string;
  description: string;
  placeholder: ReactNode;
  onClose: () => void;
  onSave: (image: string) => void;
}

interface Loaded {
  src: string;
  width: number;
  height: number;
}

const VIEWPORT = 260;
const OUTPUT = 512;
const ZOOM_STEP = 0.25;
const MAX_ZOOM = 4;
const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_SIZE = 8 * 1024 * 1024;

/** A square image picker with drag, zoom and a 512px PNG export. */
export function ImageCropDialog({
  open,
  title,
  description,
  placeholder,
  onClose,
  onSave,
}: Props) {
  const [image, setImage] = useState<Loaded | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const baseScale = image
    ? Math.max(VIEWPORT / image.width, VIEWPORT / image.height)
    : 1;
  const displayWidth = image ? image.width * baseScale * zoom : 0;
  const displayHeight = image ? image.height * baseScale * zoom : 0;

  function clampOffset(next: { x: number; y: number }, atZoom = zoom) {
    if (!image) return next;
    const width = image.width * baseScale * atZoom;
    const height = image.height * baseScale * atZoom;
    const maxX = Math.max(0, (width - VIEWPORT) / 2);
    const maxY = Math.max(0, (height - VIEWPORT) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function reset() {
    setImage(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError("");
    drag.current = null;
  }

  function take(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Escolha uma imagem PNG, JPG ou WebP.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("A imagem pode ter no máximo 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) {
        setError("Não foi possível ler a imagem.");
        return;
      }
      const loaded = new Image();
      loaded.onload = () => {
        setImage({ src, width: loaded.naturalWidth, height: loaded.naturalHeight });
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setError("");
      };
      loaded.onerror = () => setError("Não foi possível abrir a imagem.");
      loaded.src = src;
    };
    reader.onerror = () => setError("Não foi possível ler a imagem.");
    reader.readAsDataURL(file);
  }

  function setZoomAt(next: number) {
    const value = Math.min(MAX_ZOOM, Math.max(1, next));
    setZoom(value);
    setOffset((current) => clampOffset(current, value));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    current.x = event.clientX;
    current.y = event.clientY;
    setOffset((previous) => clampOffset({ x: previous.x + dx, y: previous.y + dy }));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function save() {
    if (!image) return;
    const loaded = new Image();
    loaded.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const context = canvas.getContext("2d");
      if (!context) {
        setError("Não foi possível recortar a imagem.");
        return;
      }
      const ratio = OUTPUT / VIEWPORT;
      context.drawImage(
        loaded,
        OUTPUT / 2 - (displayWidth * ratio) / 2 + offset.x * ratio,
        OUTPUT / 2 - (displayHeight * ratio) / 2 + offset.y * ratio,
        displayWidth * ratio,
        displayHeight * ratio,
      );
      onSave(canvas.toDataURL("image/png"));
      reset();
      onClose();
    };
    loaded.onerror = () => setError("Não foi possível recortar a imagem.");
    loaded.src = image.src;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title={title}
      description={description}
      closeLabel="Fechar"
      width={440}
    >
      <DialogBody className="jeff-logo-dialog">
        {image ? (
          <div className="jeff-logo-crop">
            <div
              className="jeff-logo-crop__viewport"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              role="group"
              tabIndex={0}
              aria-label="Área de recorte. Arraste ou use as setas para enquadrar."
              onKeyDown={(event) => {
                const step = 10;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setOffset((previous) => clampOffset({ x: previous.x - step, y: previous.y }));
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setOffset((previous) => clampOffset({ x: previous.x + step, y: previous.y }));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setOffset((previous) => clampOffset({ x: previous.x, y: previous.y - step }));
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOffset((previous) => clampOffset({ x: previous.x, y: previous.y + step }));
                }
              }}
            >
              <img
                src={image.src}
                alt=""
                draggable={false}
                style={{
                  width: displayWidth,
                  height: displayHeight,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                }}
              />
            </div>
            <div className="jeff-logo-crop__controls">
              <Button
                variant="link"
                disabled={zoom <= 1}
                onClick={() => setZoomAt(zoom - ZOOM_STEP)}
              >
                Afastar
              </Button>
              <Button
                variant="link"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => setZoomAt(zoom + ZOOM_STEP)}
              >
                Aproximar
              </Button>
              <Button variant="link" onClick={() => picker.current?.click()}>
                Outra imagem
              </Button>
            </div>
            <input
              ref={picker}
              className="jeff-logo-crop__file"
              type="file"
              accept={ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) take(file);
                event.target.value = "";
              }}
            />
          </div>
        ) : (
          <div
            className="jeff-logo-dialog__drop"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a, input")) return;
              event.currentTarget.querySelector<HTMLInputElement>('input[type="file"]')?.click();
            }}
          >
            <FileUpload
              label={
                <span className="jeff-logo-dialog__label">
                  {placeholder}
                  <span>Solte uma imagem aqui</span>
                </span>
              }
              hint="JPG, PNG ou WebP, até 8 MB"
              accept={ACCEPT}
              maxSize={MAX_SIZE}
              onFiles={(picked) => {
                if (picked[0]) take(picked[0]);
              }}
            />
          </div>
        )}
        {error ? <p className="jeff-logo-dialog__error">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cancelar
        </Button>
        <Button variant="primary" size="sm" disabled={!image} onClick={save}>
          Salvar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
