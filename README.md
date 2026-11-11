# Ragnaduck

A three.js survival game: a viking holds a fjord island against giant brain-eating ducks.

`index.html` is the whole game: a single page that loads three.js from a CDN. Opened from any static host it runs offline and keeps a local best score. Deployed on Vercel with the `api/` routes next to it, it adds sign-in, posted scores, player stats and a leaderboard.

## Deploying the online version (Vercel + Neon)

1. **Vercel project.** Create a new project from this repo with the "Other" framework preset. No build command is needed.
2. **Database.** Add a Neon database to the project (Storage tab), which sets `DATABASE_URL`. Run `schema.sql` once in the Neon SQL editor.
3. **Neon Auth.** Enable Auth for the same Neon project and branch, then:
   - set `NEON_AUTH_BASE_URL` in Vercel to the Auth URL Neon shows;
   - add your production domain to Neon Auth's trusted domains;
   - turn on the sign-in methods you want (the game offers Google, GitHub and email with password). For production, give Google and GitHub your own OAuth credentials.
4. **Cookie secret.** Set `NEON_AUTH_COOKIE_SECRET` to a random string of at least 32 characters, e.g. `openssl rand -base64 32`.

Sign-in only works on domains listed as trusted in Neon Auth, so add a preview domain there if you want to test on one.

## How sign-in works

Accounts are managed by [Neon Auth](https://neon.com/docs/auth/overview) (managed Better Auth) and stored in the `neon_auth` schema of the same database.

The browser never talks to Neon's domain. `vercel.json` sends everything under `/api/auth/` to `api/auth.js`, which hands it to the proxy from `@neon/auth/server`. That keeps the session cookie first-party; a cookie on Neon's own domain would be a third-party cookie, which Safari blocks.

The game calls the standard Better Auth endpoints through that proxy: `sign-in/social`, `sign-in/email`, `sign-up/email`, `sign-out` and `get-session`. After a Google or GitHub sign-in the browser returns with a one-time `neon_auth_session_verifier` in the address, which the game trades in through `get-session`.

The other routes read the session with the same proxy helper. The game's own `players` table holds only a display name and a ban flag per account. The default display name is the first word of the account name, and players can change it from the leaderboard screen. Emails and full names are never returned by the game's API.

`@neon/auth/server` is marked beta by Neon, so the dependency is pinned to patch releases.

## API

| Route | What it does |
| --- | --- |
| `GET/POST /api/auth/*` | Proxy to Neon Auth. |
| `GET /api/me` | The signed-in player and their stats. |
| `POST /api/me` | Change the display name. |
| `POST /api/runs/start` | Issues a run ticket. Limited to 30 per 10 minutes per player. |
| `POST /api/runs/finish` | Closes the ticket with the run summary, validates it and records the score. |
| `GET /api/leaderboard?period=all\|week` | Each player's best valid run, top 50. |

POST routes refuse requests whose `Origin` is not this site.

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
SELECT r.finished_at, p.name, r.flagged, r.summary FROM runs r JOIN players p ON p.id = r.player_id
WHERE r.flagged IS NOT NULL ORDER BY r.finished_at DESC LIMIT 50;

-- hide a player from the leaderboard
UPDATE players SET banned = true WHERE id = 123;

-- rename a player
UPDATE players SET name = 'Viking' WHERE id = 123;

-- hide one run
UPDATE runs SET flagged = 'manual' WHERE id = '...';

-- who is behind a player
SELECT u.email FROM players p JOIN neon_auth."user" u ON u.id::text = p.user_id WHERE p.id = 123;
```

## Tests

```
npm install
npm test
```

The API tests run the routes against an in-process Postgres (PGlite) with `schema.sql` applied and a stand-in for the Neon Auth service, so they need no database or network.

To try the game alone, serve the folder with any static server, e.g. `npx serve`.
