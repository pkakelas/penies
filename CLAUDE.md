# bouzouki / Πενιά (Penia)

Penia is a site for practising bouzouki over real recordings. A song from YouTube is split into stems with MVSEP; the site plays the backing with the lead bouzouki and the vocals on switches, at 50–150% speed without changing pitch. The site is in Greek (default, at `/`) and English (`/en`).

How a song gets onto the site:

1. An admin signs in at `/admin` and pastes a YouTube link. The page inserts a `songs` row with status `queued`.
2. `worker.py`, running on the user's Mac, picks the row up, runs the split, uploads three stems to Supabase Storage and sets the row to `draft`.
3. The admin opens the draft's song page (only admins can see it), fixes title and artist, and presses Publish. Published songs are listed on the landing page.

Songs are only processed while the worker is running. Supabase cannot run `yt-dlp` or wait on MVSEP, which is why the worker lives on the Mac.

## Layout

- `guitar_split.py`: the MVSEP pipeline, usable as a CLI and imported by the worker (`split_song(url, folder, report=...)`). It downloads the audio with `yt-dlp` and starts one run of the MVSEP preset `mpouzouki` (`PRESET_ID = 2644`), which returns three stems:
  - `lead-guitar`: the "lead guitar" of MVSEP's "Lead/Rhythm Guitar" model (two-stage). This is the bouzouki in these songs.
  - `vocals`: BS PolarFormer (124 bands) run on the Lead/Rhythm model's "no guitar" output.
  - `instruments`: that vocal model's instrumental plus the rhythm guitar, added together by a Mix node.
  - The preset is a graph edited at https://mvsep.com/presets and is private to the user's MVSEP account. The names above are the labels of its Output nodes (all MP3 320 kbps); `guitar_split.py` matches the result files by those labels, so renaming an Output breaks the pipeline. To change models, edit the preset there; the code does not choose them.
- `worker.py`: the link between Supabase and the pipeline. Commands:
  - `uv run worker.py`: watch for queued songs and process them (resumes a song left in `processing`).
  - `uv run worker.py once`: process what is waiting, then exit.
  - `uv run worker.py add-admin USERNAME`: create an `/admin` login, or reset its password. Asks for the password in the terminal.
  - `uv run worker.py import FOLDER --url URL [--title T --artist A --publish]`: upload a song folder that was already split locally.
  - Intermediate files go to `work/<song id>/`; the folder is deleted on success and kept on failure so a retry does not pay for the MVSEP jobs again.
- `supabase/`: `config.toml` and the migration that defines everything in the database (`migrations/20261106150000_songs.sql`).
- `web/`: the Next.js site (see below).
- `stems/player.html` + `stems/SignalsmithStretch.js`: the earlier standalone player, which opens a local song folder straight from disk. `stems/<song>/` holds local copies of a song's stems (five files in folders made before the preset, three now; it plays both). Not used by the site.
- `.claude/launch.json`: starts the site's dev server for the preview pane.

## Supabase

- Organisation `bouzouki`, project `penia` (ref `vmcjcicqcacwlnfozyyi`, eu-central-1). There is no Docker on this Mac, so there is no local Supabase: everything runs against this cloud project.
- `songs`: `status` is `queued → processing → draft → published` (or `failed`, with `error`); `step`/`step_detail` show the worker's progress; `stems` maps stem name → path in the bucket; `slug` is the page address (the video id until the worker replaces it with one made from the title); `artist` is who sings in this recording, `first_performed` (free text, often only a year) and `first_singer` are the song's first performance. Admins fill these in; the song page shows the ones that are set.
- `admins` + `is_admin()`: who may use `/admin`. Row-level security: anyone reads published songs; admins read and change everything. A song cannot be published without stems.
- Bucket `stems` (private): `<song id>/<stem>.mp3` for `instruments`, `lead-guitar`, `vocals`. Songs split before the preset also have `rhythm-guitar`, which is not inside their `instruments`; the player adds it to the backing when a song has it. A stem can be downloaded by whoever can read its song, so a draft's audio is admin-only. About 24 MB per song.
- Public sign-up is off. An admin "username" is the Supabase Auth email `username@admin.penia.app` (`ADMIN_EMAIL_DOMAIN`, defined in both `worker.py` and `web/src/lib/supabase.ts`; keep them equal).
- Schema changes: add a migration, then `supabase db push` (needs `SUPABASE_DB_PASSWORD` from `.env`).

## Secrets

- `.env` (git-ignored): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`, `MVSEP_API_TOKEN`. Used by `worker.py` and `guitar_split.py`. Never print, commit or share these. `.env.example` lists the names.
- `.env.admin` (git-ignored): the username and generated password of the `/admin` login `pkakelas`. Never print or share it. It goes stale if the password is changed with `add-admin`.
- `web/.env.local` (git-ignored): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These are meant for the browser; the secret key must never go into `web/`.

## The site (`web/`)

Next.js 16 (App Router, React 19, Tailwind v4) with `cacheComponents`. **This Next.js differs from older versions: read the relevant guide in `web/node_modules/next/dist/docs/` before changing routing, caching or data loading** (see `web/AGENTS.md`).

- Routes: `src/app/(el)/…` is the Greek site and `src/app/(en)/en/…` the English one, each with its own root layout (so `<html lang>` is right). Pages: landing, `songs/[slug]`, `admin`. The route files are one-liners; the pages themselves are in `src/components/` and take a `lang` prop.
- `src/lib/i18n.ts`: every piece of text in both languages. New text goes here, in both.
- `src/lib/songs.ts`: published songs for server rendering, cached (`"use cache"`, tag `songs`). `/admin` calls `refreshSongs()` (`src/app/actions.ts`) after a change so public pages update at once.
- `src/components/SongRoute.tsx`: a song page. If no published song has the slug, `DraftPreview` asks again from the browser with the admin's sign-in, which is how drafts are tested.
- `src/lib/engine.ts` + `src/components/Player.tsx`: the player. The stems are mixed into six channels (0-1 backing = instruments, plus rhythm guitar in songs that have it as a separate stem, 2-3 vocals, 4-5 lead) and fed to one Signalsmith Stretch node (`public/vendor/SignalsmithStretch.js`, npm `signalsmith-stretch` 1.3.2, MIT, unmodified, loaded as a plain script); one node keeps the stems in sync and does the time-stretch. Position is tracked in the engine (`anchorPos`/`anchorTime`/`rate`) and every play, seek and speed change is sent with `stretch.schedule(...)`.
- `src/components/Admin.tsx`: sign-in, add a video, progress of the worker (polled every 4 s while something is queued or processing), edit, test, publish/unpublish, delete.
- `src/components/Strings.tsx`: the bouzouki strings on the landing page (canvas; optional plucked-string sound, off by default).
- Design: warm black, cream and brass (colours and the `.range` slider in `src/app/globals.css`); Noto Serif Display for titles, Commissioner for text, both with Greek.

## Running

```bash
uv run worker.py              # process songs added in /admin (leave it running)
npm --prefix web run dev      # the site at http://localhost:3000
```

- Checks for the site: `npm --prefix web run build` and `npm --prefix web run lint`.
- The pipeline alone, without Supabase: `uv run guitar_split.py "https://www.youtube.com/watch?v=VIDEO_ID"` saves three stems into `stems/<video title>/`. Re-running is safe: a folder that has its stems is skipped and a submitted run is resumed from `.mvsep-jobs.json` in the song folder.
- Python dependencies (`yt-dlp`, `requests`) are declared inline in the scripts and installed by `uv`. There is no `ffmpeg` on this machine and none is needed.
- The site is not deployed anywhere yet.

## MVSEP API notes

- Docs: https://mvsep.com/full_api
- The account is premium (bought credits). A run of the preset costs 2 credits per minute of audio (1 per model), so about 8 for a four-minute song; `GET /api/app/user?api_token=...` shows the credits left (`premium_minutes`).
- Create: `POST /api/separation/create` with `preset_id` (then `sep_type`, `add_opt*` and `output_format` are ignored); poll: `GET /api/separation/get?hash=...&api_token=...`. A preset run is only visible with the token of the account that started it; without it the answer is `not_found`.
- A finished run has `data.type = "preset_run"` and one entry in `data.files` per Output node; the entry's `type` is that node's label.
- The token is in the URL of the poll request, and `requests` quotes the URL in its exceptions. Never put such an exception's text into the `songs.error` column or the log (`wait_for_result` reports only the kind of error).
- `GET /api/app/algorithms` (no token) lists every model with its `render_id` (= `sep_type`), options and SDR scores. The preset editor offers the same models as nodes, plus Mix (adds its inputs), Gain, Ensemble, Invert and others.
