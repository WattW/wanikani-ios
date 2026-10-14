# WaniKani Review Priority for iOS

A single userscript for **Userscripts + Safari on iPhone/iPad**. It reorders **reviews only**:

1. Current-level radicals
2. Current-level kanji
3. Remaining radicals
4. Remaining kanji
5. All vocabulary, including kana-only vocabulary

**[Install the userscript](https://raw.githubusercontent.com/WattW/wanikani-ios/main/wanikani-review-priority.user.js)** — open this link in Safari on your iPhone or iPad.

## New in 1.1.0: answer assistance

- **Current-level mistake protection:** a wrong answer triggers WaniKani's native wiggle and retry message. The attempt does not add an incorrect-answer count or advance the question. This applies to current-level radicals, kanji, vocabulary, and kana-only vocabulary. Other levels are graded normally.
- **Cheat · Fill answer:** shown below the answer area for current-level items only. It fills a correct meaning or the accepted reading for the question currently on screen, then focuses the input. **You still submit the answer yourself.** It is disabled after a question has been graded.
- **Correct-answer reveal:** an incorrect answer at any level shows the correct meaning or reading below the input. Native retry warnings also reveal the answer; empty submissions do not. The reveal clears on the next question. For kanji, the filled reading uses the reading type WaniKani accepts for that item.

These features are enabled automatically. The level detected at the start of the session controls both ordering and protection; reload after leveling up.

**Already installed?** Update to **1.1.0** in Userscripts' available updates view, or reopen the installation link in Safari and use Userscripts to update/replace the existing script. Then reload the review page. Keep only one copy enabled.

## Install on iOS

1. Install [Userscripts by quoid](https://apps.apple.com/app/userscripts/id1463298887) and open the app once. Keep its default local script directory; this avoids iCloud file eviction and sync delays. If your version asks for a directory, select a folder under **On My iPhone/iPad**.
2. In **Settings → Apps → Safari → Extensions → Userscripts**, enable **Allow Extension**. On older iOS versions, the path starts at **Settings → Safari**.
3. Open the **[direct installation link](https://raw.githubusercontent.com/WattW/wanikani-ios/main/wanikani-review-priority.user.js)** in Safari. Seeing JavaScript text is expected.
4. Open Safari's page menu (the icon beside the address bar; **aA** on older versions), choose **Manage Extensions** if necessary to enable Userscripts, then open **Userscripts**. Allow access to this installation page if prompted. Tap **Userscript Detected / Install**, then confirm installation. The wording may vary by version.
5. Visit [WaniKani](https://www.wanikani.com/dashboard), sign in, open the Userscripts extension, and allow it to run on **www.wanikani.com**. Confirm **WaniKani Review Priority for iOS** is enabled.
6. Disable any other script that reorders reviews or changes answer grading. Start a **new review session**, or reload the review page before answering. A short preparation dialog is followed by a button such as **L17 · Current-level radicals**. Tap it to see the five starting group counts.

You do **not** need to create, rename, or manually save a `.js` file. Userscripts installs it into its own directory from the link. No WaniKani API key, Open Framework, or Queue Manipulator installation is required.

Use iOS/iPadOS **15.4 or later** (the preparation dialog uses Safari's native dialog support). Current iOS is recommended.

## Behavior

- Only the regular `/subjects/review` session is reordered. Lessons, lesson quizzes, and Extra Study are untouched.
- The script reads the current level from WaniKani's user menu, fetching the signed-in dashboard when necessary. If the menu format is not recognized, it asks you to enter your level for that session. It never guesses your level from due items.
- All due subjects in the session are retained, including subjects beyond WaniKani's initial preload. A large backlog can take longer to prepare.
- The initial order within each group is preserved. WaniKani may interleave unfinished subjects within that group; the next group waits until the preceding group is finished. Reading/meaning order, completion submission, and Wrap Up remain WaniKani's responsibility. Current-level failed answers are converted to WaniKani's native retry result before they reach its error tracking or SRS calculations. Failures on other levels are unchanged.
- The current level stays fixed during a session. After leveling up, start a fresh session to use the new level.
- The script reads WaniKani's subject data and makes same-origin GET requests using your existing login. It contains no API token, analytics, or external runtime dependencies. GitHub hosts the script and update metadata.
- It listens for WaniKani's Turbo page navigation, so entering reviews from the dashboard is supported. The broad WaniKani URL match exists for that navigation; queue changes are restricted to reviews.

## Troubleshooting and updates

- **No installation prompt:** use Safari and the direct `raw.githubusercontent.com` link above, not GitHub's file-view page or an in-app browser. Open the Userscripts extension while the script text is visible and allow access to that page.
- **No priority button:** verify the script is installed/enabled and Userscripts has permission for `www.wanikani.com`, then reload the review page. If you chose iCloud storage, mark that folder **Keep Downloaded** in Files, or move to the app's local directory.
- **Priority off:** tap the button to see the reason. Check your connection, let WaniKani finish loading, and reload before answering. If WaniKani changes its queue interface, the script may need an update.
- **Wrong current level:** reload the review page to reread the dashboard. If a manual level was requested, use the level displayed on your dashboard.
- **No Cheat button:** it appears only on a current-level item. Confirm version **1.1.0** is installed, then reload the review page. After a correct answer, advance to the next question to enable the button again.
- **Disable:** switch off the script in Userscripts, then reload WaniKani. This restores WaniKani's usual ordering.
- **Update:** check Userscripts' available updates view. The script includes both a `.meta.js` update URL and a `.user.js` download URL. Reopening the install link also lets you install the current version; avoid keeping duplicate copies.

## Development and verification

No build or npm dependencies are required. Run with Node.js 20+:

```sh
npm test
npm run check
```

The tests cover the five groups, kana vocabulary, stable ordering, queues beyond 100 items, invalid metadata, queue-state preservation, answer protection, accepted readings, answer fill, answer reveal, retry behavior, and installation metadata. Integration tests run WaniKani's publicly served input controller, queue, and answer helpers with simulated DOM/network boundaries. Version 1.0 ordering has been confirmed working on iOS Safari; **the new 1.1 answer features have not been independently tested on a physical iPhone.**

To repeat the optional integration tests against WaniKani's current public source, run `node scripts/fetch-queue-source.mjs`, set the `WK_QUEUE_SOURCE_DIR` environment variable to the printed directory, and rerun `npm test`. They simulate a 257-item session with wrong answers under both reading/meaning preferences and Wrap Up, then exercise protected retries, ordinary failures, corrected submissions, native warnings, empty inputs, and double taps through the native input controller. Without that variable, the integration tests are skipped. No upstream source is redistributed.

When releasing, update `@version` in both `wanikani-review-priority.user.js` and `wanikani-review-priority.meta.js`, and update `package.json`.

## References

- [Userscripts installation and metadata documentation](https://github.com/quoid/userscripts#usage)
- [WaniKani Queue Manipulator documentation](https://community.wanikani.com/t/for-userscript-authors-wk-queue-manipulator/61302) (background on WaniKani's queue interface; not a dependency)

MIT licensed. Unofficial; not affiliated with WaniKani or Tofugu.
