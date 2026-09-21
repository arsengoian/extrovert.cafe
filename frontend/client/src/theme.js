// Тема: «як у пристрої», світла або темна. Вибір гравця живе в
// localStorage, бо це налаштування пристрою, а не акаунта.
const KEY = "extrovert.theme";
const media = window.matchMedia?.("(prefers-color-scheme: light)");

export const getThemeMode = () => localStorage.getItem(KEY) || "system";

export function applyTheme(mode = getThemeMode()) {
  const resolved = mode === "system" ? (media?.matches ? "light" : "dark") : mode;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "light" ? "#F7F4EC" : "#0C0E11");
  return resolved;
}

export function setThemeMode(mode) {
  if (mode === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  return applyTheme(mode);
}

// Системна тема може змінитись поки застосунок відкритий — слухаємо лише
// тоді, коли гравець сам не вибрав конкретну.
media?.addEventListener?.("change", () => {
  if (getThemeMode() === "system") applyTheme("system");
});

applyTheme();
