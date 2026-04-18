# Privacy Policy — Usage Budget for Claude

## What this extension collects

The extension stores **usage percentages and timestamps** locally in your browser (`chrome.storage.local`). Specifically:

- Usage percentage at each check interval (every 10 seconds while the page is visible)
- Timestamp of each reading
- Last known session data (percentage, time remaining, rate)

This data is used solely to calculate your consumption rate and project future usage.

## What this extension does NOT do

- Does not send any data to external servers
- Does not make any network requests
- Does not track your conversations, prompts, or Claude usage content
- Does not use analytics or telemetry of any kind
- Does not access your Anthropic account credentials

## Where data is stored

All data is stored locally in `chrome.storage.local` on your device. It never leaves your browser.

## How to delete your data

Uninstall the extension, or go to `chrome://extensions` → "Usage Budget for Claude" → **Remove**. This deletes all stored data.

Alternatively, open the browser console on any page and run:
```js
chrome.storage.local.clear()
```

## Trademark notice

"Claude" is a trademark of Anthropic, PBC. This extension is not affiliated with, endorsed by, or sponsored by Anthropic.

## Contact

This is an open-source project. For questions, open an issue at https://github.com/hispafox/claude-budget-ext
