# fitness-tracker — Claude working notes

Static PWA, no build step, no backend. `index.html` + `app.js` are the
whole app; `app.js`'s remote-sync section talks directly to the GitHub
Contents API for `jackdengler/private-data-storage/fitness.json`. See
README.md for the data-storage and PAT-scope details before changing
sync behavior.

Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to
`main` — no separate build/test step to run locally beyond opening
`index.html` in a server (see README "Local dev").
