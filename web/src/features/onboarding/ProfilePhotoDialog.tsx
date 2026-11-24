import { ImageCropDialog } from "./ImageCropDialog";

interface Props {
  open: boolean;
  photo?: string | null;
  initial: string;
  onClose: () => void;
  onSave: (photo: string) => void;
}

export function ProfilePhotoDialog({ open, photo, initial, onClose, onSave }: Props) {
  return (
    <ImageCropDialog
      open={open}
      title="Foto do perfil"
      description="Arraste para enquadrar. O quadrado é o que aparece."
      placeholder={
        photo ? (
          <img src={photo} alt="" draggable={false} className="jeff-logo-dialog__placeholder" />
        ) : (
          <span className="jeff-profile-photo-placeholder">{initial}</span>
        )
      }
      onClose={onClose}
      onSave={onSave}
    />
  );
}
