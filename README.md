# Πενιές (Penies)

A site for practising bouzouki over real recordings: https://www.penies.gr

A song from YouTube is split into three stems (the lead bouzouki, the vocals and everything else) with [MVSEP](https://mvsep.com). The site plays the backing with the bouzouki and the vocals on switches, at 50–150% speed without changing pitch. It is in Greek, with an English version at `/en`.

## How it works

1. An admin pastes a YouTube link at `/admin`, which queues the song in Supabase.
2. `worker.py`, running on a Mac, picks it up, fills in the song's details with Claude, splits it with MVSEP and uploads the stems to Supabase Storage as a draft.
3. The admin checks the draft, corrects the details and publishes it.

## Layout

- `guitar_split.py`: the MVSEP pipeline (also usable on its own).
- `worker.py`: connects Supabase to the pipeline.
- `supabase/`: database schema, config and email templates.
- `web/`: the Next.js site.
- `stems/player.html`: an earlier standalone player for local stems.

## Running

Requires macOS (audio goes through `afconvert`), [uv](https://docs.astral.sh/uv/) and Node.js. Copy `.env.example` to `.env` and fill it in, and give `web/` a `.env.local` with the Supabase URL and publishable key.

```bash
uv run worker.py              # process songs added in /admin
npm --prefix web run dev      # the site at http://localhost:3000
```

To split a single song without Supabase:

```bash
uv run guitar_split.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

`CLAUDE.md` has the full details of the pipeline, the database and the site.

## License

[MIT](LICENSE.md). The player's time-stretching uses [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch), also MIT.
