# Extension asset provenance

The extension vendors a deliberately small, self-contained subset of the author's own
`acne-design-system`, an unpublished personal design system. That CSS is original work by the author
and is covered by this repository's MIT license. The build performs no network font or stylesheet
requests.

## Source files

SHA-256 values were rechecked immediately before copying on 2026-07-20.

| Source                          | SHA-256                                                            | Vendored use                                                                       |
| ------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `tokens.css`                    | `333334d7129799f1963cce6cfa287de888fb98a00ece5dfe0988f7bde191320b` | Complete token foundation                                                          |
| `base.css`                      | `df96025efc9b8303b98942c2f965998ecc17f329205f953e0848baabc7b1c020` | Complete reset, typography, focus, and reduced-motion foundation                   |
| `components.css`                | `8f3c3c52f82e57a508a95b4048de4d678cdd9052a13f61ba24359d8d9b28bcdc` | Only the used button, chip, and badge rules were copied to `vendor/components.css` |
| `fonts/inter-400.woff2`         | `8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc` | Inter regular                                                                      |
| `fonts/inter-500.woff2`         | `f3779f1efccc4bdcdf9c0a02ab95bf6bd092ed09c48c08cedc725889edd1d19f` | Inter medium                                                                       |
| `fonts/ibm-plex-mono-400.woff2` | `08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7` | IBM Plex Mono regular                                                              |

The source `components.css` hash records the complete reviewed source even though only the named
rules are redistributed. Inter and IBM Plex Mono are free, open-licensed fonts under SIL Open Font
License 1.1. The license and copyright notices are distributed beside the font files in
`extension/vendor/fonts/OFL.txt` and copied into the built extension.

LCTrack's logo uses Lucide SquareTerminal, the standard Lucide icon available through shadcn/ui.
Lucide is distributed under the ISC License; its notice is included at
`extension/icons/LICENSE-lucide.txt`. Chrome does not support SVG files declared as extension icons,
so `extension/square-terminal.svg` is rendered at exactly 16, 32, 48, and 128 pixels under
`extension/icons/` and copied into the production extension build. The macOS builder renders that
same canonical SVG into every required `.icns` representation and bundles the vector itself for the
menu-bar mark; it does not introduce a separately drawn application logo.
