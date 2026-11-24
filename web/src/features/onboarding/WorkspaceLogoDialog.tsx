import { ImageCropDialog } from "./ImageCropDialog";

interface Props {
  open: boolean;
  currentLogo?: string | null;
  defaultLogo: string;
  onClose: () => void;
  onSave: (logo: string) => void;
}

export function WorkspaceLogoDialog({ open, currentLogo, defaultLogo, onClose, onSave }: Props) {
  return (
    <ImageCropDialog
      open={open}
      title="Logo do workspace"
      description="Arraste para enquadrar. O quadrado é o que aparece. PNG com fundo transparente fica melhor."
      placeholder={
        <img
          src={currentLogo ?? defaultLogo}
          alt=""
          draggable={false}
          className="jeff-logo-dialog__placeholder"
        />
      }
      onClose={onClose}
      onSave={onSave}
    />
  );
}
