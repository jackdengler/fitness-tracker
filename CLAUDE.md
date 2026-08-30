# fitness-tracker — Claude working notes

Static PWA, no build step, no backend. `index.html` + `app.js` are the
whole app; `app.js`'s remote-sync section talks directly to the GitHub
Contents API for `jackdengler/private-data-storage/fitness.json`. See
README.md for the data-storage and PAT-scope details before changing
sync behavior.

Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to
`main` — no separate build/test step to run locally beyond opening
`index.html` in a server (see README "Local dev").

Saved data (localStorage + `fitness.json`) outlives any shipped
default, so anything that reshapes it — reordering the A/B/C split,
renaming an exercise, adding a field to `templates`/`exerciseArchive`
— goes through `MIGRATIONS` in `app.js` (recorded in `db.migrations`,
run once locally and once against the remote copy) or through the
always-idempotent normalization in `ensureTemplates()`. A fresh DB
starts with every migration marked done, because the shipped defaults
already reflect them.

Charts are hand-rolled inline SVG (`timeChart`) — no chart library, no
build step. Colors come from the `--ch-*` custom properties in
`index.html` so light/dark swap in one place.

A logged workout is a snapshot: each set stores its own `equip`/`mode`
when it is logged, and nothing in history reads today's
`templates`/`exerciseArchive` values. Changing an exercise in Edit
Workouts must never rewrite a past log — sets recorded before the app
tracked this read as "not recorded" and are set by hand on the logged
workout itself.
