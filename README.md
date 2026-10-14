# WaniKani Review Priority for iOS

A single userscript for **Userscripts + Safari on iPhone/iPad**. It reorders **reviews only**:

1. Current-level radicals
2. Current-level kanji
3. Remaining radicals
4. Remaining kanji
5. All vocabulary, including kana-only vocabulary

**[Install the userscript](https://raw.githubusercontent.com/WattW/wanikani-ios/main/wanikani-review-priority.user.js)** — open this link in Safari on your iPhone or iPad.

## Install on iOS

1. Install [Userscripts by quoid](https://apps.apple.com/app/userscripts/id1463298887) and open the app once. Keep its default local script directory; this avoids iCloud file eviction and sync delays. If your version asks for a directory, select a folder under **On My iPhone/iPad**.
2. In **Settings → Apps → Safari → Extensions → Userscripts**, enable **Allow Extension**. On older iOS versions, the path starts at **Settings → Safari**.
3. Open the **[direct installation link](https://raw.githubusercontent.com/WattW/wanikani-ios/main/wanikani-review-priority.user.js)** in Safari. Seeing JavaScript text is expected.
4. Open Safari's page menu (the icon beside the address bar; **aA** on older versions), choose **Manage Extensions** if necessary to enable Userscripts, then open **Userscripts**. Allow access to this installation page if prompted. Tap **Userscript Detected / Install**, then confirm installation. The wording may vary by version.
5. Visit [WaniKani](https://www.wanikani.com/dashboard), sign in, open the Userscripts extension, and allow it to run on **www.wanikani.com**. Confirm **WaniKani Review Priority for iOS** is enabled.
6. Disable any other script that reorders reviews. Start a **new review session**, or reload the review page before answering. A short preparation dialog is followed by a button such as **L17 · Current-level radicals**. Tap it to see the five starting group counts.

You do **not** need to create, rename, or manually save a `.js` file. Userscripts installs it into its own directory from the link. No WaniKani API key, Open Framework, or Queue Manipulator installation is required.

Use iOS/iPadOS **15.4 or later** (the preparation dialog uses Safari's native dialog support). Current iOS is recommended.

## Behavior

- Only the regular `/subjects/review` session is reordered. Lessons, lesson quizzes, and Extra Study are untouched.
- The script reads the current level from WaniKani's user menu, fetching the signed-in dashboard when necessary. If the menu format is not recognized, it asks you to enter your level for that session. It never guesses your level from due items.
- All due subjects in the session are retained, including subjects beyond WaniKani's initial preload. A large backlog can take longer to prepare.
- The initial order within each group is preserved. WaniKani may interleave unfinished subjects within that group; the next group waits until the preceding group is finished. Reading/meaning order, incorrect-answer tracking, SRS, completion submission, and Wrap Up remain WaniKani's responsibility.
- The current level stays fixed during a session. After leveling up, start a fresh session to use the new level.
- The script reads WaniKani's subject data and makes same-origin GET requests using your existing login. It contains no API token, analytics, or external runtime dependencies. GitHub hosts the script and update metadata.
- It listens for WaniKani's Turbo page navigation, so entering reviews from the dashboard is supported. The broad WaniKani URL match exists for that navigation; queue changes are restricted to reviews.

## Troubleshooting and updates

- **No installation prompt:** use Safari and the direct `raw.githubusercontent.com` link above, not GitHub's file-view page or an in-app browser. Open the Userscripts extension while the script text is visible and allow access to that page.
- **No priority button:** verify the script is installed/enabled and Userscripts has permission for `www.wanikani.com`, then reload the review page. If you chose iCloud storage, mark that folder **Keep Downloaded** in Files, or move to the app's local directory.
- **Priority off:** tap the button to see the reason. Check your connection, let WaniKani finish loading, and reload before answering. If WaniKani changes its queue interface, the script may need an update.
- **Wrong current level:** reload the review page to reread the dashboard. If a manual level was requested, use the level displayed on your dashboard.
- **Disable:** switch off the script in Userscripts, then reload WaniKani. This restores WaniKani's usual ordering.
- **Update:** check Userscripts' available updates view. The script includes both a `.meta.js` update URL and a `.user.js` download URL. Reopening the install link also lets you install the current version; avoid keeping duplicate copies.

## Development and verification

No build or npm dependencies are required. Run with Node.js 20+:

```sh
npm test
npm run check
```

The tests cover the five groups, kana vocabulary, stable ordering, queues beyond 100 items, invalid metadata, queue-state preservation, and installation metadata. Queue integration was checked against WaniKani's publicly served queue implementation during development. **A signed-in session on a physical iPhone has not been verified.** The first real review session should show the detected level and expected group before answering.

To repeat the optional integration test against WaniKani's current public source, run `node scripts/fetch-queue-source.mjs`, set the `WK_QUEUE_SOURCE_DIR` environment variable to the printed directory, and rerun `npm test`. It simulates a 257-item session with wrong answers under both reading/meaning preferences, as well as Wrap Up. Without that variable, the integration test is skipped. No upstream source is redistributed.

When releasing, update `@version` in both `wanikani-review-priority.user.js` and `wanikani-review-priority.meta.js`, and update `package.json`.

## References

- [Userscripts installation and metadata documentation](https://github.com/quoid/userscripts#usage)
- [WaniKani Queue Manipulator documentation](https://community.wanikani.com/t/for-userscript-authors-wk-queue-manipulator/61302) (background on WaniKani's queue interface; not a dependency)

MIT licensed. Unofficial; not affiliated with WaniKani or Tofugu.
