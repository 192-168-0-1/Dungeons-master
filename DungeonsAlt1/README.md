# Dungeons for Alt1

This is the Alt1 version of the `Dungeons` project. It does not use or modify `AbilityTracker`.

## Features

- Automatically waits for a Dungeoneering map, then calibrates and starts reading it.
- Automatic recalibration when the map moves or its floor size changes.
- Small, medium and large floors.
- Live room count, possible rooms, rooms per minute, dead ends and timer.
- Original captured map or a clean abstract map view.
- Grid, automatic critical path and manual critical markings.
- Labels of up to four characters, drawn directly over the rooms on the RuneScape map through the native Alt1 overlay.
- Local G1/G2 and color-coded team gatestones drawn on the native RuneScape map overlay.
- Personal gatestone detection that excludes boss-room markers and player arrows.
- Shared team labels and gatestones through the existing WebSocket relay.
- A five-player Dungeoneering party panel that assigns the fixed red, cyan, green, yellow and grey player colors by join order. Labels and G1/G2 markers use the owner's current party color on every connected screen.
- Optional RuneScape party-interface scanning uses the official Alt1 sprite OCR to read the five colored RSN rows. A successfully read row overrides join order locally; closing the interface or an OCR miss safely falls back to the synced roster.
- PNG export of the visible map.
- Dungeoneering results-screen OCR for time, floor, modifiers, bonus and XP at 100–200% interface scale. Result PNGs wait for final stable values and preserve the full physical interface crop.

## Saving map and results PNGs

Alt1 1.6 can open Chromium's folder picker, but its embedded browser cannot grant
the write permission needed by the File System Access API. Choosing the folder
again therefore cannot repair a failed write.

On Alt1 1.6, every enabled map/results PNG export is automatically kept in the
app's internal IndexedDB capture archive. Use **Download stored captures (.zip)**
to open one Save As dialog containing the original separate PNG files. The app
does not clear those files after starting a download; verify the ZIP first, then
use **Clear stored captures**. In a normal browser, and in a future Alt1 host
whose real folder write succeeds, the existing automatic map/results folder
saving remains available.

## Run locally

Alt1 apps are web apps and must be served over HTTP. From the repository root, run:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m http.server 8080
```

Then open:

```text
http://localhost:8080/DungeonsAlt1/
```

Click **Install**. If the protocol link does not open, add this URL manually in Alt1:

```text
http://localhost:8080/DungeonsAlt1/appconfig.json
```

The app now waits automatically. Open a Dungeoneering map and it will calibrate without pressing the button.

Keep **Display → Draw labels and gatestones in game** enabled to render annotations and gatestones directly on the native RuneScape map.

## Publish with GitHub Pages

The repository includes `.github/workflows/deploy-dungeons-alt1.yml`. It publishes only the `DungeonsAlt1` directory, with no build step or permanent local server.

1. Push the repository to GitHub.
2. Open **Settings → Pages** in the GitHub repository.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Run the workflow once from **Actions**, or push a change under `DungeonsAlt1` on `main` or `master`.
5. Install the public manifest in Alt1:

```text
https://<username>.github.io/<repository>/appconfig.json
```

For the currently configured remote, the expected URL is:

```text
https://192-168-0-1.github.io/Dungeons-master/appconfig.json
```

Every later push that changes `DungeonsAlt1` deploys the new version automatically.

## Tests

With Node.js installed:

```powershell
cd DungeonsAlt1
npm test
```

Without Node.js, validate the source assets and Alt1 manifest with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\test\validate.ps1
```
