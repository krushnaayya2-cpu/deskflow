# DeskFlow

A lightweight Windows 11 companion that organizes your desktop, replaces the taskbar with a customizable glass dock, adds a Dynamic Island, converts files from a hover menu, and highlights your AI apps.

Built with **Tauri 2** (Rust + React/TypeScript + Tailwind). No Electron, no telemetry, everything runs offline.

## Status

| Step | Feature | State |
|---|---|---|
| 1 | Project setup, tray app, settings, autostart, global hotkey | ✅ Done |
| 3 | Dynamic Island (built early, on request) | ✅ Done |
| 2 | Glass dock and theme system | ✅ Done |
| 4 | Hover-to-convert circle menu and conversion engine | ✅ Done |
| 5 | Desktop organizer | Planned |
| 6 | AI spotlight and notifications | Planned |
| 7 | Performance pass and installer polish | Planned |

## Using it (step 1)

- DeskFlow lives in the **system tray**. Left-click the icon to open settings; right-click for the menu (Open settings, Start with Windows, Quit).
- **Ctrl+Alt+D** opens settings from anywhere. Change it under *General → Open settings hotkey*.
- **Start with Windows** is on by default. When launched at sign-in, DeskFlow starts silently in the tray.
- Closing the settings window keeps DeskFlow running. Use *Quit DeskFlow* in the tray menu to exit.
- Launching DeskFlow a second time just brings up the settings window of the running copy.

## Dock

A dock with your pinned and running apps that can replace the Windows taskbar.

- Thirteen designs: **Glass** (real Windows acrylic blur), **Minimal**, **Neon**, **Classic bar**, **Floating pills**, **Windows 11**, **Edge tab**, **Pebble**, **Rail**, **Underlined**, **Split** (Start/Search · apps · tray capsules), **Stack** (tray above apps) and **Pastel tiles**.
- System tray (Wi-Fi, volume, battery → Quick Settings; clock → calendar), Search button, icon styles (original, mono, accent silhouette), dividers between icons.
- Pinned apps are imported from your taskbar on first run. Running apps show an indicator (focused app highlighted).
- Click to open/focus (click again to minimise, or cycle windows), middle-click for a new window, right-click for Show / New window / Pin / Show in folder / Close. Drag icons to reorder pinned apps.
- macOS-style magnification and a launch bounce.
- Settings → *Dock*: icon size, spacing, corner radius, blur strength, opacity, accent, magnification, glass/solid/transparent background, bottom/left/right, auto-hide, main or all displays, Start button, clock, running apps, add apps from the Start menu.
- **Hide the Windows taskbar** (optional). DeskFlow restores it, with its original auto-hide setting, when you turn the option off or quit.
- Themes: presets for every design plus Onyx, Silver, Indigo outline, Night shelf, Dusk pebble and Sage capsules, save your own, and export/import themes as `.json` files.

## File converter

- **Hover** a file on the desktop or in File Explorer for ~0.6 s → a round button appears next to the cursor → click for a radial menu of conversions. A progress ring and a success pulse follow; the result is saved next to the original and the Dynamic Island offers **Open**.
- Also: **right-click → Convert with DeskFlow** (Windows 11: under "Show more options"), a floating **drop zone**, and **Settings → Converter → Choose files…**.
- Built in (no extra software): JPG/PNG/WebP/BMP/GIF/TIFF ↔ PNG/JPG/WebP, images → PDF (several into one), merge PDFs, compress PDFs.
- With free tools DeskFlow can install for you (via winget): **LibreOffice** (Word/PowerPoint/Excel → PDF, PDF → Word), **FFmpeg** (MP4 → MP3/GIF/WAV, MOV/MKV → MP4, audio formats), **Poppler** (PDF → JPG pages).
- Conversions run one at a time in the background; nothing leaves your PC.

## Dynamic Island

A pill at the top-centre of the screen (click-through when you're not touching it).

- **Hover** to expand, **click** for details, **press and hold** for quick actions (1/5/15/25-minute timers, play/pause, settings).
- Live activities: music from any media app (with previous/play-pause/next), timers, charger plugged in/out and low battery, Wi-Fi/network changes, and finished downloads (with Open and Show in folder).
- Settings → *Dynamic Island*: on/off, size, glass or solid, main display or all displays, distance from top, hide when idle, which activities to show, and a **Show sample** preview button.
- **Music player styles** (Settings → Dynamic Island): 16 themes — Spectrum, Cosmic Dust, Pixel Pulse, Aurora Flow, Liquid Chrome, Neon Orbit, Emerald Rain, Mono Wave, Holographic, Ice Glass, Solar Flare, Abyss Blue, Blood Moon, Dark Plasma, Phantom Green, Void Pulse — or match the island design. Each has a compact pill, a hover player bar and a full player (click) with album art, an audio-reactive visualizer, progress/seek, shuffle, repeat and system volume.
- Bluetooth changes, file-conversion progress and AI notifications are added with later steps.

## Settings file

All settings are saved locally in one JSON file:

```
%APPDATA%\com.deskflow.app\config.json
```

*About → Open folder* opens it in File Explorer. Missing fields fall back to defaults, and a corrupt file is renamed to `config.json.bak` instead of being overwritten.

## Building

### Automatically (GitHub Actions)

Every push to `main` builds on Windows and runs the tests. Download the installers from the run's **Artifacts** section (`DeskFlow-installers-…` contains the `.msi` and the setup `.exe`).

### Locally on Windows

Prerequisites: [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs), and the *Visual Studio C++ Build Tools* (the "Desktop development with C++" workload). WebView2 ships with Windows 11.

```powershell
.\scripts\build.ps1          # tests + installers in src-tauri\target\release\bundle
npm install; npx tauri dev   # run with hot reload while developing
```

## Project layout

```
settings.html            Entry page for the settings window (one HTML entry per window)
src/
  lib/config.ts          Typed bridge to the Rust config + change events
  lib/theme.ts           Dark/light mode and accent colour (CSS variables)
  lib/hotkey.ts          Key event -> "Ctrl+Alt+D" style combo
  settings/              Settings window UI (sidebar, sections, controls)
src-tauri/
  src/lib.rs             App bootstrap: plugins, setup, window/exit behaviour
  src/config.rs          JSON config with defaults, validation, atomic saves (+ tests)
  src/commands.rs        Commands called from the UI; applies config changes
  src/tray.rs            Tray icon and menu
  src/hotkey.rs          Global settings hotkey (+ tests)
  src/windows.rs         Window helpers (show settings, theme)
  tauri.conf.json        Windows, Mica effect, installer targets
.github/workflows/       Windows CI build producing installers
scripts/build.ps1        Local build script
```

## Performance targets

Idle RAM under 80 MB, idle CPU near 0%, startup under 2 seconds, 60 fps animations. Each window loads only its own bundle, the backend is event-driven (no polling loops), and release builds use LTO with a stripped binary. Performance work (v0.6.0):
- The settings window is created only when opened and destroyed when closed, so it uses no memory while DeskFlow sits in the tray. With the island and dock turned off, no browser engine runs at all.
- All windows share one WebView2 browser process and renderer; the island and dock ask WebView2 to keep memory low while the mouse isn't over them.
- Running apps are tracked from Windows window events instead of polling; the hover check slows down when the mouse is far away; battery/network are read every 5 s.
- Visualizers are capped at 24–40 fps; animated island borders only run while the island is expanded.
- Settings → About shows live memory (as Task Manager reports it), CPU and startup time.

## Privacy

DeskFlow makes no network requests of its own and collects no telemetry. (The local notification API in step 6 will listen on `localhost` only.)
