# Ragnaduck

A three.js survival game: a viking holds a fjord island against giant brain-eating ducks.

`index.html` is the whole game. On a static host (GitHub Pages) it runs offline and keeps a local best score. Deployed on Vercel with the `api/` routes next to it, it adds GitHub sign-in, posted scores, player stats and a leaderboard.

## Deploying the online version (Vercel + Neon)

1. **Vercel project.** Create a new project from this repo with Root Directory `html/ragnaduck` and the "Other" framework preset. No build command is needed.
2. **Database.** Add a Neon database to the project (Storage tab), which sets `DATABASE_URL`. Run `schema.sql` once in the Neon SQL editor.
3. **GitHub OAuth app.** Create one under GitHub Settings → Developer settings → OAuth Apps, with the callback URL `https://<your-domain>/api/auth/callback`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Vercel.
4. **Session secret.** Set `SESSION_SECRET` to a long random string, e.g. `openssl rand -base64 48`.

A GitHub OAuth app has one callback URL, so sign-in works on the production domain only, not on preview deployments.

## API

| Route | What it does |
| --- | --- |
| `GET /api/auth/login` | Redirects to GitHub. No scopes are requested; only the public profile is read. |
| `GET /api/auth/callback` | Creates or updates the user and sets a signed, HttpOnly session cookie. |
| `POST /api/auth/logout` | Clears the session. |
| `GET /api/me` | The signed-in player and their stats. |
| `POST /api/runs/start` | Issues a run ticket. Limited to 30 per 10 minutes per player. |
| `POST /api/runs/finish` | Closes the ticket with the run summary, validates it and records the score. |
| `GET /api/leaderboard?period=all\|week` | Each player's best valid run, top 50. |

## How fake scores are kept out

The browser cannot be trusted, so the server decides what counts:

- **Sign-in:** only signed-in players can post, and each appears on the board once.
- **Run tickets:** a score must be posted against a ticket issued when the run started. A ticket works once, only for its owner, and the server knows how old it is.
- **Plausibility checks** (`api/_lib/rules.js`): the game sends a breakdown rather than a bare score, and the server checks it against the rules:
  - the run is not longer than the ticket has existed, and not shorter than the spawn timers allow for the waves cleared;
  - kills per duck type cover every cleared wave and do not exceed what the waves reached contain;
  - the score lies between what those kills are worth and the most the combo multiplier and bonuses could add.

A rejected run is stored with the reason in `runs.flagged` and never shown. The client is only told "Run rejected".

These checks stop invented numbers, replayed requests and edited scores. They do not stop someone who fabricates a fully consistent run, or a bot that plays well. Closing that gap needs replay verification: a deterministic game whose recorded inputs the server re-simulates.

`api/_lib/rules.js` repeats the wave contents and point values from `index.html`. `npm test` fails if the two drift apart.

## Moderation

```sql
-- rejected runs, newest first
SELECT r.finished_at, u.name, r.flagged, r.summary FROM runs r JOIN users u ON u.id = r.user_id
WHERE r.flagged IS NOT NULL ORDER BY r.finished_at DESC LIMIT 50;

-- hide a player from the leaderboard
UPDATE users SET banned = true WHERE name = 'someone';

-- hide one run
UPDATE runs SET flagged = 'manual' WHERE id = '...';
```

## Tests

```
npm install
npm test
```

The API tests run the routes against an in-process Postgres (PGlite) with `schema.sql` applied, so they need no database or network.
