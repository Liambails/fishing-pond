# COBALT V3.10.16 install / validation

No database migration is required.

## Replace the local working tree

```bash
cd ~
rm -rf /tmp/cobalt-31016
mkdir -p /tmp/cobalt-31016
unzip -q ~/Downloads/COBALT_V3.10.16_FINAL_SEARCH_DISCOVERY_GATE.zip -d /tmp/cobalt-31016

rsync -av \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='scheduler_debug.jsonl' \
  --exclude='relist_debug' \
  /tmp/cobalt-31016/cobalt_v31016/ ~/cobalt/
```

## Validate

```bash
cd ~/cobalt/web
node -p "require('./package.json').version"
rm -rf .next
npm run test:all
npm run build
```

Expected version: `3.10.16`.

Then:

```bash
cd ~/cobalt
python3 -m py_compile \
  worker/search_watches.py \
  worker/cadence.py \
  worker/db.py \
  worker/run.py
node --check worker/collector.js
git diff --check
```

## Deploy

```bash
cd ~/cobalt
git status --short
git diff --check
git add .
git commit -m "Release COBALT V3.10.16 search discovery vehicle filter"
git push origin main
```

Production pins `SEARCH_WATCH_MAX_LISTING_PRICE_NZD=5000` in `observe.yml`.
