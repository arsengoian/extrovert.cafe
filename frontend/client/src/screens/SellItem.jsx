// P2P: виставити річ на продаж і зняти з продажу.
//
// Маркет не показує лоти списком — він пропонує вибірку, і дешевші лоти
// потрапляють у неї частіше (services.md §4). Тому тут же видно лічильник
// показів: без нього продавець не розуміє, чому річ не продається.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

export function SellItem({ item, ctx }) {
  const [price, setPrice] = useState(String(item?.price_coins ?? 60));
  const [listings, setListings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.get("/me/listings").then((r) => setListings(r.listings));
  useEffect(() => { load().catch(() => setListings([])); }, []);

  const value = Math.trunc(Number(price) || 0);
  const commission = Math.round((value * 10) / 100);   // одяг — 10 % (economy §9)

  const list = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/market/listings", {
        kind: "item",
        user_item_id: item.user_item_id,
        price: value,
        currency: "yellow",
      });
      await load();
      setError(null);
    } catch (e) {
      const code = e.body?.error;
      setError(code === "item_locked" ? "Річ замкнена в подарованому комплекті"
        : code === "item_in_set" ? "Річ зараз одягнена — спершу зніми її"
        : code === "already_listed" ? "Ця копія вже на продажу"
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id) => {
    setBusy(true);
    try { await api.del(`/market/listings/${id}`); await load(); }
    catch (e) { setError(e.body?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const mine = (listings ?? []).filter((l) => l.kind === "item");

  return (
    <div className="stage-pad">
      <div className="panel row" style={{ gap: 12 }}>
        <ItemIcon sprite={item.sprite_id} size={56} style={{ width: 56 }} name={item.name} />
        <div>
          <div style={{ fontWeight: 800 }}>{item.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            вільних копій: {item.free ?? 0}{item.owned > 1 ? ` з ${item.owned}` : ""}
          </div>
        </div>
      </div>

      <div className="sectionTitle">Ціна</div>
      <div className="panel row" style={{ gap: 10 }}>
        <input
          className="price-input"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <img src="/assets/ui/coin_gold.png" alt="монет" style={{ width: 22 }} />
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
        Комісія маркету — 10 %. З {value || 0} ти отримаєш {Math.max(0, value - commission)}.
        Дешевші лоти маркет пропонує покупцям частіше.
      </p>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-primary" disabled={busy || !item.free || value < 1} onClick={list}>
        Виставити на продаж
      </button>

      {mine.length > 0 && (
        <>
          <div className="sectionTitle">Твої лоти</div>
          {mine.map((lot) => (
            <div key={lot.id} className="panel row" style={{ gap: 10, padding: 12 }}>
              <ItemIcon sprite={lot.item?.sprite_id} size={36} style={{ width: 36 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{lot.item?.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  показів: {lot.impressions} · комісія {lot.commission_pct} %
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="price" style={{ fontSize: 13 }}>
                  {lot.price}<img src="/assets/ui/coin_gold.png" alt="" />
                </div>
                <button className="btn" style={{ width: "auto", height: 30, padding: "0 10px", fontSize: 12, marginTop: 4 }}
                        disabled={busy} onClick={() => cancel(lot.id)}>Зняти</button>
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>
            Лічильник показів відстає не більше ніж на хвилину.
          </p>
        </>
      )}
    </div>
  );
}
