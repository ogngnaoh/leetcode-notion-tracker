# Project tree

```text
leetcode-notion-tracker/
├── .env.example
├── .gitignore
├── AGENTS.md
├── CODEX_HANDOFF_PROMPT.md
├── PROJECT_TREE.md
├── README.md
├── STATUS.md
├── VERIFICATION.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── MANUAL_TEST.md
│   ├── NOTION_SCHEMA.md
│   └── SECURITY.md
│
├── examples/
│   ├── capture.json
│   └── curl-capture.sh
│
├── extension/
│   ├── manifest.json
│   ├── options.html
│   ├── sidepanel.html
│   ├── styles.css
│   └── src/
│       ├── api.ts
│       ├── background.ts
│       ├── content.ts
│       ├── options.ts
│       ├── sidepanel.ts
│       ├── storage.ts
│       └── types.ts
│
├── scripts/
│   ├── build-extension.mjs
│   └── scan-secrets.mjs
│
├── src/
│   ├── bridge/
│   │   ├── app.ts
│   │   ├── capture-service.ts
│   │   ├── env.ts
│   │   ├── memory-repository.ts
│   │   ├── notion-repository.ts
│   │   ├── repository.ts
│   │   └── server.ts
│   ├── notion/
│   │   ├── io.ts
│   │   ├── schema.ts
│   │   ├── setup.ts
│   │   └── verify.ts
│   └── shared/
│       ├── contract.ts
│       ├── keys.ts
│       └── review.ts
│
└── test/
    ├── app.test.ts
    ├── capture-service.test.ts
    ├── keys.test.ts
    ├── notion-schema.test.ts
    └── review.test.ts
```
