# Dungeons for Alt1

This is the Alt1 version of the `Dungeons` project. It does not use or modify `AbilityTracker`.

## Features

- Automatically waits for a Dungeoneering map, then calibrates and starts reading it.
- Automatic recalibration when the map moves or its floor size changes.
- Small, medium and large floors.
- Live room count, possible rooms, rooms per minute, dead ends and timer.
- Original captured map or a clean abstract map view.
- Grid, automatic critical path and manual critical markings.
- Labels of up to four characters, including an Alt1 in-game overlay.
- Personal gatestone detection.
- Shared team labels and gatestones through the existing WebSocket relay.
- PNG export of the visible map.
- Dungeoneering results-screen OCR for time, floor, modifiers, bonus and XP.

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

## Publish with GitHub Pages

The repository includes `.github/workflows/deploy-dungeons-alt1.yml`. It publishes only the `DungeonsAlt1` directory, with no build step or permanent local server.

1. Push the repository to GitHub.
2. Open **Settings → Pages** in the GitHub repository.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Run the workflow once from **Actions**, or push a change under `DungeonsAlt1`.
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

