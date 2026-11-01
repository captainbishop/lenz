# Rendering homepage previews

The six silent videos show private messaging, offline onward payments and adding a
person by Lenz ID in both themes. They use editable HTML text and vector elements
at 1200 × 1320 and 30 fps. They are illustrated replays of tested behavior, not
live transactions or complete recordings of application screens.

The message text and payment states are checked against the saved source flow.
The payment sequence retains its original 1-tUSD receipts. Rendering never repeats
funding, signing or settlement. Profile scenes use a disposable, unfunded identity;
the abbreviated address is a visual example, not a reusable contact.

## Local prerequisites

- Node.js 22 or later, Playwright, Sharp and installed Edge.
- Hyperframes 0.8.226 and its bundled GSAP 3.15.0.
- FFmpeg and FFprobe 9.0.2.
- A locally installed Segoe UI font for the product typography.
- The saved test profiles and packet capture used by the presentation replay.

Set these environment variables to the corresponding absolute local paths:

| Variable | Value |
| --- | --- |
| `LENZ_MEDIA_WORKSPACE` | An external directory for compositions, tools and render intermediates |
| `LENZ_GSAP_FILE` | The installed `gsap.min.js` |
| `LENZ_PREVIEW_FONT` | The installed `segoeui.ttf` |
| `LENZ_HYPERFRAMES_ENTRY` | The installed `hyperframes/bin/hyperframes.mjs` |
| `HYPERFRAMES_FFMPEG_PATH` | FFmpeg executable |
| `HYPERFRAMES_FFPROBE_PATH` | FFprobe executable |

Start the application at `http://127.0.0.1:4173`, then run from the repository root:

```sh
node web/reframe-preview-flow.cjs
node web/render-preview-stories.cjs
```

This creates `chat-light`, `wallet-light`, `profile-light` and matching dark
projects in the external directory. Run `hyperframes check <project> --json` for
each and save its JSON as `<variant>-check.json` in that directory. All six checks
must pass with the browser audit enabled. Inspect every scene with
`hyperframes snapshot <project> --review`, then open the editable preview with
`hyperframes preview <project> --background`.

After visual review, export and check the actual decoded videos:

```sh
node web/record-preview-videos.cjs
node web/verify-preview-videos.mjs --update-cache
node web/verify-preview-flow.mjs
node web/video-previews.test.cjs
```

The exporter checks dimensions, duration, silent audio, changing decoded frames and
distinct central product regions for every scene. It writes only the final MP4s,
posters and their source manifest into the app. Review the generated phone sheets
in the external workspace's `decoded` directory. Passing machine checks does not
replace visual inspection or establish production safety.

The homepage uses left/right taps for scene navigation and press-and-hold to pause.
Arrow keys navigate; Space or Enter toggles playback. It retains
reduced-motion preferences, off-screen pause,
theme switching, keyboard tabs, pointer response and offline playback. An updated
service-worker revision prevents a saved homepage from retaining obsolete videos.
