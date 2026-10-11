// Лінтер тримаємо мінімальним: він тут не для стилю, а щоб не їхали в прод
// помилки, які збірка не бачить. Саме такі два випадки трапились
// 23.09.2026 — <TopbarBack /> без імпорту (екран падав у браузері) і
// звернення до змінної, перейменованої в сусідньому рядку.
//
//   bun run lint
import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "db/**", "design/**", "raspberry/**"] },

  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser, Bun: "readonly" },
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      // Ядро: змінна, якої немає, і змінна, яку більше ніхто не читає.
      // Порядок важливий — наші налаштування мають стояти ПІСЛЯ набору
      // recommended, інакше він їх перекриє.
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
      // JSX-теги ядро не перевіряє — це окреме правило плагіна react.
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      // Хук нижче раннього return — і екран падає цілком, в error boundary:
      // поки вантажаться дані, хук не викликається, після їх приходу —
      // викликається, і React валить дерево на зміні кількості хуків. Саме
      // так 11.10.2026 лягла сторінка точки, а ні лінтер, ні збірка цього не
      // бачили. Беремо лише rules-of-hooks: exhaustive-deps свариться на
      // купу чинного коду й привчав би ігнорувати вивід.
      "react-hooks/rules-of-hooks": "error",
      // Решта стилю — не наша справа: у репозиторії свій формат, і сварка
      // лінтера на нього лише привчає ігнорувати його вивід.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Свариться на захисне значення за замовчуванням (let answer = {…}
      // перед try) — а це навмисний прийом, а не помилка. Лінтер, який
      // падає на не-багах, швидко привчає ігнорувати свій вивід.
      "no-useless-assignment": "off",
    },
  },
];
