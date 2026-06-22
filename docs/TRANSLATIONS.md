# Translation Management

This project uses [Transifex](https://www.transifex.com/) for translation management.

## Supported Languages

| Code | Language   | Status   |
|------|-----------|----------|
| en   | English   | Source   |
| el   | Greek     | Complete |
| fi   | Finnish   | Complete |
| pt   | Portuguese| Complete |
| sv   | Swedish   | Complete |

## File Structure

Translation files are i18next JSON format located in `src/locales/`:

```
src/locales/
├── en.json   (source - English)
├── el.json   (Greek)
├── fi.json   (Finnish)
├── pt.json   (Portuguese)
└── sv.json   (Swedish)
```

## Transifex Setup

The project is configured in `.tx/config`. To sync translations:

```bash
# Install the Transifex CLI
pip install transifex-client
# or
brew install transifex-client

# Push source strings to Transifex
tx push -s

# Pull translations from Transifex
tx pull -a

# Pull a specific language
tx pull -l sv
```

## Adding a New Language

1. Add the locale file: `src/locales/<code>.json`
2. Import it in `src/i18n.js` and add to the `resources` object
3. Add the language option in `src/components/LanguageSelector/languages.ts`
4. Run `tx push -s` to update source strings on Transifex
5. Translate on Transifex, then `tx pull -l <code>`

## Translation Keys Convention

- Use nested JSON objects for namespacing (e.g., `pageSettings.title.language`)
- Use camelCase for key names
- Keep interpolation variables in `{{double_braces}}`
- HTML/React elements use `<tagName>content</tagName>` syntax (Trans component)
- Reference other keys with `$t(namespace.key)` syntax

## CI Integration

After Transifex is provisioned, a GitHub Action will automatically:
1. Push source string changes to Transifex on merge to `release/sirosid`
2. Open a PR with updated translations when translators complete work on Transifex
