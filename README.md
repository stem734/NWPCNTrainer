# S1 Hotspot Training Builder

A static browser app for creating interactive training pages from SystmOne screenshots.

## What it does

- Load a clean screenshot of a SystmOne visualisation.
- Draw section-level hotspots over the screenshot.
- Add manual guidance for each section.
- Save progress locally in the browser using IndexedDB, with a localStorage fallback.
- Export/import project JSON for backup or sharing.
- Export a standalone HTML training page for use on a website, intranet, Teams/SharePoint library, or PCN resource page.

## Important information governance note

Do not publish screenshots containing patient-identifiable information. Use dummy data, a test patient, or crop/redact any identifiable details before exporting and publishing.

## Running locally

Open `index.html` directly in Chrome or Edge.

No install, build step, server, or internet connection is required.

## GitHub Pages deployment

Because this is a static app, GitHub Pages can host it directly.

1. Open the GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/** root
4. Save.

## Project persistence

Projects are saved in the browser profile using IndexedDB where available, with localStorage as a fallback. This means:

- progress survives browser restarts;
- it is local to that browser/device;
- clearing browser site data will delete saved projects;
- use **Export project JSON** for a robust backup.

## Files

- `index.html` – app shell
- `src/app.js` – app logic, IndexedDB save, hotspot editing and HTML export
- `src/styles.css` – editor styling
