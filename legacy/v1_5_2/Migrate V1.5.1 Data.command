#!/bin/bash
set -e
DEST="$(cd "$(dirname "$0")" && pwd)"
SRC="$(dirname "$DEST")/fishing_pond_v1_5_1"

if [ ! -d "$SRC/data" ]; then
  echo "Could not find: $SRC/data"
  echo "Keep fishing_pond_v1_5_1 beside this V1.5.2 folder, then run this again."
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Migrating your V1.5.1 data into V1.5.2..."
mkdir -p "$DEST/data" "$DEST/backups" "$DEST/exports"
cp -a "$SRC/data/." "$DEST/data/"
[ -d "$SRC/backups" ] && cp -a "$SRC/backups/." "$DEST/backups/" || true
[ -d "$SRC/exports" ] && cp -a "$SRC/exports/." "$DEST/exports/" || true

cd "$DEST"
python3 - <<'PY'
import fishing_pond
fishing_pond.ensure()
print("V1.5.2 migration/repair pass complete.")
print("Listings:", len(fishing_pond.load(fishing_pond.LISTINGS)))
print("Observations:", len(fishing_pond.load(fishing_pond.OBS)))
PY

echo
echo "Done. Your original V1.5.1 folder was NOT changed."
echo "Now reload the V1.5.2 Chrome extension and run Fishing Pond V1.5.2."
read -r -p "Press Enter to close..."
