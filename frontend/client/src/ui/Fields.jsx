// Поля форм — за макетом (кадри «Розкажи про себе · крок 1–6»): один
// варіант — великий рядок із кружечком, сегмент — рівні кнопки в ряд,
// кілька варіантів — чипи, що переносяться, текст — поле на два рядки.
// Один набір на всі квізи й форми — інакше кожен екран малював би свої.
export function Choice({ options, value, onChange, multi = false }) {
  if (multi) {
    // Мультивибір віддає функцію, а не готовий масив: два швидкі тапи підряд
    // бачать однаковий value з пропсів, і другий затирав би перший.
    const toggle = (o) => onChange((prev) => {
      const list = prev ?? [];
      return list.includes(o) ? list.filter((x) => x !== o) : [...list, o];
    });
    return (
      <div className="chips">
        {options.map((o) => (
          <button key={o} aria-pressed={(value ?? []).includes(o)} onClick={() => toggle(o)}>{o}</button>
        ))}
      </div>
    );
  }

  return (
    <div className="opts">
      {options.map((o) => (
        <button key={o} className="opt" aria-pressed={value === o} onClick={() => onChange(o)}>
          <i />
          {o}
        </button>
      ))}
    </div>
  );
}

export function Segment({ options, value, onChange }) {
  return (
    <div className="segs">
      {options.map((o) => (
        <button key={o} aria-pressed={value === o} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

// tall — велике поле останнього кроку анкети (118 px, як у макеті).
export function TextField({ value, onChange, placeholder, rows = 2, tall = false }) {
  return (
    <textarea
      className={tall ? "textarea tall" : "textarea"}
      value={value}
      rows={rows}
      placeholder={placeholder ?? "Напиши своїми словами"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Сітка напоїв із картинками — «Яку каву п'єш найчастіше?». Картинки
// приходять разом із питанням (api/quiz: sprites), тому нові напої з'являються
// тут самі, щойно їх додали в каталог.
export function DrinkGrid({ options, sprites = {}, value, onChange }) {
  return (
    <div className="drink-grid">
      {options.map((o) => (
        <button key={o} className="drink-cell" aria-pressed={value === o} onClick={() => onChange(o)}>
          <span>{sprites[o] && <img src={`/assets/drinks/${sprites[o]}.png`} alt="" />}</span>
          <b>{o}</b>
        </button>
      ))}
    </div>
  );
}
