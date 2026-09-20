// Нижня шторка з притемненням — так у дизайні показані всі попапи
// (Phone.dc.html, dim + панель знизу).
export function Sheet({ title, onClose, children }) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="h2" style={{ margin: 0 }}>{title}</div>
          <button className="icon-btn" aria-label="Закрити" onClick={onClose} data-active="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
