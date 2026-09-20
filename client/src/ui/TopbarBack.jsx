export function TopbarBack({ title, onBack }) {
  return (
    <div className="topbar-back">
      <button className="icon-btn" aria-label="Назад" onClick={onBack} data-active="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
      </button>
      <div className="title">{title}</div>
      <div style={{ width: 36, flex: "none" }} />
    </div>
  );
}
