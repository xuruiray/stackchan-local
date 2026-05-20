# Contributing

StackChan Local is an experimental hardware project. Keep changes small, testable, and local-first.

## Development Loop

```bash
npm install
npm run typecheck
npm test
```

Firmware changes should also pass:

```bash
cd firmware
idf.py build
```

## Guidelines

- Do not commit real `.env` files, pairing tokens, API keys, or local absolute paths.
- Do not commit generated dependency/build directories.
- Keep the runtime free of cloud server requirements.
- Keep protocol changes backwards compatible when possible and add schema tests.
- For hardware features, document whether values are real, derived, or placeholders.
- For UI changes, check both narrow vertical layout and desktop layout.

## Pull Requests

Include:

- What changed.
- How you tested it.
- Whether firmware flashing or hardware validation was performed.
- Any known limitations.
