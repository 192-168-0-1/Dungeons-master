# Ability Rotation Tracker

`AbilityTracker.exe` is a separate, self-contained Windows x64 application. It does not require Dungeons or a separately installed .NET runtime. It observes the RuneScape client; it never sends keyboard or mouse input.

## First setup

1. Paste a Discord-style rotation on the **Rotation import & editor** tab and parse it, or paste a PvME Discord channel link and choose **Fetch rotations**. If a guide contains multiple rotations, the app shows a selection dialog with a preview.
2. Icons are resolved and downloaded from the RuneScape Wiki automatically during import. A PvME import also retains every original emoji ID; if a compact PvME name has no unambiguous Wiki page, the exact icon from the guide is cached instead. Uncertain non-PvME matches stay yellow until confirmed.
3. Capture the RuneScape client on **Screen calibration**. Drag tightly around each complete action-bar grid and around only the coloured adrenaline fill line.
4. Run icon matching and OCR. Correct yellow keybind cells manually or use **Capture selected keybind**.
5. Save the rotation, open **Live tracker**, and start it. Default hotkeys are `Ctrl+Shift+F8` and `Ctrl+Shift+F9`.

Rotations and calibration are stored under `%APPDATA%\DungeonsAbilityTracker`. Downloaded Wiki icons are cached under `%LOCALAPPDATA%\DungeonsAbilityTracker` and are not part of the repository. Live usage history is discarded when the application closes.

## Rotation syntax

- `→` or `->`: next step.
- `+` or adjacent `:tokens:`: all actions belong to one group and may occur in any order.
- `(:actionA: / :actionB:)`: optional alternative action.
- `>50% adren:` and `<50% adren:`: automatic adrenaline branch.
- Headings such as `Phase 1`, `Drop Down`, and `Font 1` become sections.
- Ordinary prose and bullet lines become non-blocking notes.

Wiki lookup classifies pages by their infobox and always prefers real ability pages over matching NPC/item names. Common PvM abbreviations are canonical: `:anti:` always searches for Anticipation and `:cade:` for Barricade. Combined tokens such as `:anticlearheaded:` use the Anticipation ability icon and retain Clear Headed as a perk modifier. Exact page lookup is used before broad search to avoid rate limiting when a guide contains many tokens.

PvME links are imported through PvME's public channel mapping and public guide repository, so no Discord login or user token is needed. Other Discord servers cannot be read without explicit Discord API access and are not imported.

The screen-capture implementation is shared with Dungeons through `ScreenCapture/`; neither executable needs the other one to be running.
