/** The app's first paint: the Toph cloud hopping while the session restores. */
export default function TophBoot() {
  return (
    <div className="toph-boot" role="status" aria-label="Carregando Toph">
      <div className="toph-boot__stage" aria-hidden="true">
        <img
          className="toph-boot__hop"
          src={`${import.meta.env.BASE_URL}brand/toph-mark.png?v=5`}
          alt=""
          draggable={false}
        />
        <span className="toph-boot__shadow" />
      </div>
      <p className="toph-boot__label">Toph</p>
    </div>
  );
}
