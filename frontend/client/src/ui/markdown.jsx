// Підмножина markdown для описів предметів: абзаци, **жирний**, *курсив*,
// списки й посилання. Сирий HTML не рендериться — описи пише адмін, але
// правило дешевше тримати, ніж потім доводити, що його не порушували.
const inline = (text, keyPrefix) => {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)]+)\))/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) out.push(<strong key={`${keyPrefix}-${i++}`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={`${keyPrefix}-${i++}`}>{token.slice(1, -1)}</em>);
    else {
      const label = token.slice(1, token.indexOf("]"));
      out.push(<a key={`${keyPrefix}-${i++}`} href={m[2]} target="_blank" rel="noopener noreferrer">{label}</a>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

export function renderMarkdown(md) {
  const blocks = String(md ?? "").split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      return (
        <ul key={bi} style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</li>)}
        </ul>
      );
    }
    return <p key={bi} style={{ margin: "0 0 8px" }}>{inline(block, String(bi))}</p>;
  });
}
