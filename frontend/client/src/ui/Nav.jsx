// Нижня навігація: п'ять вкладок, кавенятко — піднятим колом по центру.
const TABS = [
  { id: "wallet", label: "Гаманець", icon: "/assets/ui/nav_wallet.png" },
  // У макеті іконка магазину ширша за решту: 25 px проти 23.
  { id: "shop", label: "Магазин", icon: "/assets/ui/nav_shop.png", width: 25, badge: "orders" },
  { id: "plant", label: "Кавенятко", center: true },
  { id: "stock", label: "Склад", icon: "/assets/ui/nav_storage.png" },
  { id: "history", label: "Покупки", icon: "/assets/ui/nav_history.png" },
];

export function Nav({ tab, onTab, badges = {} }) {
  return (
    <nav className="nav">
      {TABS.map((t) =>
        t.center ? (
          <button key={t.id} className="nav-center" data-tap="off" data-active={String(tab === t.id)} onClick={() => onTab(t.id)}>
            <span className="bubble"><img src="/assets/ui/sprout.png" alt="" /></span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{t.label}</span>
          </button>
        ) : (
          <button key={t.id} className="nav-item" data-tap="off" data-active={String(tab === t.id)} onClick={() => onTab(t.id)}>
            <img src={t.icon} alt="" style={t.width ? { width: t.width } : undefined} />
            <span>{t.label}</span>
            {t.badge && badges[t.badge] ? <span className="nav-badge">{badges[t.badge]}</span> : null}
          </button>
        )
      )}
    </nav>
  );
}
