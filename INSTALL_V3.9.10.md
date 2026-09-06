# COBALT V3.9.10 installation

This release already contains:
- `worker/.env`
- `web/.env.local`
- the supplied root `.git/` directory

No database migration is required for V3.9.10.

## Replace the local repo

1. Back up the existing `~/cobalt` folder if desired.
2. Unzip this release.
3. Rename/move the extracted `cobalt` folder to `~/cobalt`.
4. Install web dependencies:
   ```bash
   cd ~/cobalt/web
   npm install
   npm run build
   ```
5. Install worker dependencies if the local Python environment needs them:
   ```bash
   cd ~/cobalt/worker
   python3 -m pip install -r requirements.txt
   ```
6. In Chrome, open `chrome://extensions`, enable Developer mode, remove/reload the prior unpacked COBALT extension as appropriate, then choose **Load unpacked** and select `~/cobalt/extension-v2`.
7. Open the extension options and confirm the ingest endpoint/token are correct. The endpoint now defaults to the production Vercel `/api/ingest` URL.

## Important Git note

The `.git/` directory in this archive is the exact supplied `.git` bundle. It may be older than the source tree in this release, so `git status` can legitimately show many changes/untracked files immediately after extraction. Review status before staging or pushing; do not use `git add .` blindly.
