# Contributing

StackChan Local is an experimental hardware project. Keep changes small, testable, and local-first.

## Development Loop

```bash
npm install
npm run check
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
- Before publishing or opening a PR from local hardware work, run `npm run open-source:check`.
- Do not commit `desktop/models/*.task`; use `npm run vision:model` to restore the local cache.

## Pull Requests

Include:

- What changed.
- How you tested it.
- Whether firmware flashing or hardware validation was performed.
- Any known limitations.
