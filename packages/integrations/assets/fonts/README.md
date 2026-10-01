# Report fonts

Noto Serif (Regular, Italic, Bold), used by the PDF report renderer
(`src/exports/pdf.ts`): a serif body face with Latin, Greek and Cyrillic
coverage.

- Licence: SIL Open Font License 1.1 (`OFL.txt`), which permits bundling and
  redistribution with software.
- Copied unmodified from the npm package `@expo-google-fonts/noto-serif@0.4.2`
  (files `400Regular/NotoSerif_400Regular.ttf`,
  `400Regular_Italic/NotoSerif_400Regular_Italic.ttf`,
  `700Bold/NotoSerif_700Bold.ttf`), renamed.
- SHA-256, checked by `test/exports/pdf.test.ts`:
  - `NotoSerif-Regular.ttf` a7e8ea1ab7e7d368b001c892d6148325fffc849a46e030e55e1bdc597bbe939d
  - `NotoSerif-Italic.ttf` 15d5f8050fc1f142545e7a26a50bd07a0434eca535d4d98aad9d5e8f03741e43
  - `NotoSerif-Bold.ttf` 1b941681106aae26ead3a24c6f15b51f994b1b26adce8742a37ce96648f0fe0a

Scripts outside Latin, Greek and Cyrillic (Devanagari, CJK, Arabic, ...) have
no glyphs in these faces. The renderer marks such text visibly rather than
dropping it; the JSON export always carries the exact text.
