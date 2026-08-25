# fitness-tracker

Installable PWA for workout, food, and body tracking. Runs entirely
client-side (no backend) and is embedded as a tile in the
[central-optimus](https://github.com/jackdengler/central-optimus)
launcher.

## Data storage

- Every write lands in `localStorage` immediately, so the app is fully
  usable offline.
- When embedded in the launcher, the app receives a GitHub PAT over
  `postMessage` (`type: "co.pat"`) and uses it to sync the same data,
  as JSON, to
  [`private-data-storage`](https://github.com/jackdengler/private-data-storage)`/fitness.json`
  via the GitHub Contents API. Writes are debounced (2.5s of
  inactivity) so rapid taps coalesce into one commit.
- On load, if a PAT is available, the remote copy is fetched and wins
  over the local cache — `private-data-storage` is the source of
  truth once syncing is possible.
- Visiting the app directly (outside the launcher, no PAT delivered)
  falls back to local-only storage.

**The PAT needs write access to `private-data-storage`.** Use the same
fine-grained PAT already used for the launcher's gate, and add:

- Repository access: `private-data-storage`
- Permissions: Contents = Read and write

Without that scope the app still works, it just won't sync — the
home screen's status line will read "Offline — changes saved on this
device only".

## Local dev

```
python3 -m http.server 8000
```

Open http://localhost:8000. Sync won't run locally unless you embed
this page in an iframe that posts it a `co.pat` message (the launcher
does this automatically once it's deployed).

## Deploy

`.github/workflows/deploy.yml` publishes this repo's static files to
the `gh-pages` branch on every push to `main`, served at
`https://jackdengler.github.io/fitness-tracker/`.

One-time setup: repo Settings → Pages → Source = "Deploy from a
branch", Branch = `gh-pages`, Folder = `/`.

## Registering with the launcher

Already done in `central-optimus/launcher/apps.json` — the `id:
"fitness-tracker"` entry points at the Pages URL above with
`"auth": "pat"`.
