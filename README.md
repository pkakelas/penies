# Πενιές

Play bouzouki along with the real records.

**[www.penies.gr](https://www.penies.gr)**

Learning a song by ear from the original recording is hard. The bouzouki is tangled up with everything else, it goes by fast, and the old masters won't slow down for you.

Penies pulls the bouzouki out of the song. You get the band without it, so you can take its place, or with it, so you can hear exactly what it plays. You can mute the singer too, keep the bouzouki on quietly as a guide, slow the whole thing down to half speed (or speed it up) without the pitch changing, and loop a hard passage until you have it.

The site is in Greek, with an English version at [penies.gr/en](https://www.penies.gr/en). If the song you want isn't there yet, you can ask for it from the site.

## How a song gets on the site

It starts with a YouTube link pasted into the admin page. A small script on a Mac picks it up, downloads the audio and asks Claude to look up who wrote the song and who sang it first. Then it sends the song to [MVSEP](https://mvsep.com), which splits it into three tracks: the bouzouki, the voice, and everything else. The tracks are stored in [Supabase](https://supabase.com), and once someone has listened to them and checked the details, the song goes up on the site.

The script runs on a Mac and not on a server because downloading from YouTube and waiting for MVSEP don't fit in a hosted database, and because it uses the audio tools that come with macOS.

## What's in here

| | |
|---|---|
| `web/` | The website (Next.js) |
| `worker.py` | The script that processes new songs |
| `guitar_split.py` | The part that talks to MVSEP |
| `supabase/` | The database |
| `stems/player.html` | An older player that opens tracks straight from your disk |

## Running it yourself

You'll need a Mac, [uv](https://docs.astral.sh/uv/) and Node.js. You'll also need your own Supabase project and MVSEP account: the MVSEP setup that does the splitting lives in a private account, so you'd have to build your own (it's described in `CLAUDE.md`).

Copy `.env.example` to `.env` and fill it in, give `web/` a `.env.local` with your Supabase URL and publishable key, and then:

```bash
uv run worker.py
```

```bash
npm --prefix web run dev
```

The first one waits for new songs and processes them. The second one starts the site at http://localhost:3000.

## More detail

`CLAUDE.md` has the long version: how the splitting works and why, the database, payments and every page of the site. It was written as notes for Claude Code, which helped build this project, but it reads fine for people too.

## License

MIT, see [LICENSE.md](LICENSE.md). The player slows songs down with [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch), which is MIT as well.
