#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp", "requests"]
# ///
"""Penia worker: turns songs added on the site into playable drafts.

An admin adds a YouTube link on /admin, which creates a "queued" row in the
songs table. This worker picks the row up, splits the song with MVSEP
(guitar_split.py), uploads the stems to the "stems" storage bucket and marks
the song as a draft. The admin then tests it and presses Publish.

Songs are only processed while this is running:

    uv run worker.py                      # keep watching for new songs
    uv run worker.py once                 # handle what is waiting, then stop

Other commands:

    uv run worker.py add-admin USERNAME   # create an /admin login (asks for a password)
    uv run worker.py import "stems/Song" --url "https://youtube.com/watch?v=..."
                                          # upload a song folder that was split earlier

Needs SUPABASE_URL, SUPABASE_SECRET_KEY and MVSEP_API_TOKEN, from the
environment or from the .env file next to this script.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import shutil
import sys
import time
import unicodedata
from pathlib import Path

import requests
from yt_dlp.utils import DownloadError

import guitar_split
from guitar_split import PipelineError

ROOT = Path(__file__).parent
WORK = ROOT / "work"  # scratch: one folder per song id while it is processed
BUCKET = "stems"
# Song folders split before the preset have the rhythm guitar as a file of
# its own instead of inside instruments. `import` uploads it too, and the
# site's player adds it to the backing.
OLD_RHYTHM_STEM = "rhythm-guitar"
CONTENT_TYPES = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac"}
# /admin logins are usernames; Supabase wants an email, so "maria" is stored as
# maria@<this domain>. Keep in sync with ADMIN_EMAIL_DOMAIN in web/src/lib/supabase.ts.
ADMIN_EMAIL_DOMAIN = "admin.penia.app"
POLL_SECONDS = 5


class Supabase:
    """The few Supabase REST calls the worker needs, with the secret key."""

    def __init__(self) -> None:
        guitar_split.load_env()
        url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SECRET_KEY", "")
        if not url or not key:
            sys.exit("error: set SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example)")
        self.url = url
        self.http = requests.Session()
        self.http.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def _check(self, response: requests.Response) -> requests.Response:
        if not response.ok:
            raise PipelineError(f"Supabase returned HTTP {response.status_code}: {response.text[:300]}")
        return response

    def songs(self, **filters: str) -> list[dict]:
        params = {"select": "*", "order": "created_at.asc", **filters}
        return self._check(self.http.get(f"{self.url}/rest/v1/songs", params=params, timeout=30)).json()

    def update_song(self, song_id: str, fields: dict, **filters: str) -> list[dict]:
        """Change a song; returns the changed rows (none if the filters did not match)."""
        response = self.http.patch(
            f"{self.url}/rest/v1/songs",
            params={"id": f"eq.{song_id}", **filters},
            json=fields,
            headers={"Prefer": "return=representation"},
            timeout=30,
        )
        return self._check(response).json()

    def insert_song(self, fields: dict) -> dict:
        response = self.http.post(
            f"{self.url}/rest/v1/songs",
            json=fields,
            headers={"Prefer": "return=representation"},
            timeout=30,
        )
        return self._check(response).json()[0]

    def upload(self, path: str, file: Path) -> None:
        with file.open("rb") as handle:
            response = self.http.post(
                f"{self.url}/storage/v1/object/{BUCKET}/{path}",
                data=handle,
                headers={
                    "Content-Type": CONTENT_TYPES.get(file.suffix.lower(), "application/octet-stream"),
                    "Cache-Control": "max-age=31536000",  # a song's stems never change
                    "x-upsert": "true",
                },
                timeout=600,
            )
        self._check(response)


# --- Titles and slugs --------------------------------------------------------

YOUTUBE_ID = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")
# Bits of a video title that are not part of the song's name.
TITLE_NOISE = re.compile(r"official|audio|video|lyrics|release|remaster|\bhd\b|\bhq\b|\b4k\b", re.I)
GREEK = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th",
    "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p",
    "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
}


def youtube_id(url: str) -> str:
    match = YOUTUBE_ID.search(url)
    if not match:
        raise PipelineError(f"cannot find the video id in {url!r}")
    return match.group(1)


def split_title(video_title: str) -> tuple[str, str]:
    """Guess (artist, title) from a video title such as "Artist - Song - Official Audio"."""
    parts = [part.strip() for part in re.split(r"\s+[-–—|]\s+", video_title)]
    parts = [part for part in parts if part and not TITLE_NOISE.search(part)]
    if len(parts) >= 2:
        return parts[0], parts[1]
    return "", (parts[0] if parts else video_title.strip())


def slugify(text: str) -> str:
    """Lower-case Latin slug; Greek is transliterated ("Άτακτη" -> "atakti")."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))  # drop accents
    text = text.replace("ου", "ou").replace("αυ", "av").replace("ευ", "ev")
    text = "".join(GREEK.get(ch, ch) for ch in text)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def free_slug(db: Supabase, wanted: str, song_id: str) -> str:
    """`wanted`, or wanted-2, wanted-3... if another song already uses it."""
    taken = {song["slug"] for song in db.songs(slug=f"like.{wanted}*", id=f"neq.{song_id}")}
    slug, n = wanted, 2
    while slug in taken:
        slug, n = f"{wanted}-{n}", n + 1
    return slug


# --- Processing --------------------------------------------------------------

def upload_stems(db: Supabase, song_id: str, files: dict[str, Path]) -> dict[str, str]:
    paths = {}
    for name, file in files.items():
        paths[name] = f"{song_id}/{name}{file.suffix}"
        print(f"  uploading {file.name} ({file.stat().st_size / 1e6:.1f} MB)")
        db.upload(paths[name], file)
    return paths


def describe(db: Supabase, song: dict, info: dict) -> dict:
    """Title, artist, slug and duration for a song, from its YouTube video.

    A title the admin already typed is kept.
    """
    artist, title = split_title(info["title"])
    title = song.get("title") or title
    artist = song.get("artist") or artist
    wanted = slugify(title) or song["youtube_id"].lower()
    return {
        "title": title,
        "artist": artist,
        "slug": free_slug(db, wanted, song["id"]),
        "duration_seconds": info.get("duration"),
    }


def process(db: Supabase, song: dict) -> None:
    """Split one song and leave it as a draft, or as failed with the reason."""
    song_id = song["id"]
    print(f"\n{song['youtube_url']} ({song_id})")
    last = {}

    def report(step: str, detail: str) -> None:
        print(f"  {detail}")
        if (step, detail) != (last.get("step"), last.get("detail")):
            last.update(step=step, detail=detail)
            db.update_song(song_id, {"step": step, "step_detail": detail})

    try:
        report("download", "reading the video's details...")
        details = describe(db, song, guitar_split.video_info(song["youtube_url"]))
        db.update_song(song_id, details)
        print(f"  {details['artist'] or '?'} - {details['title']}  (/songs/{details['slug']})")

        files = guitar_split.split_song(song["youtube_url"], WORK / song_id, report=report)
        report("upload", "uploading the stems...")
        stems = upload_stems(db, song_id, files)
        db.update_song(
            song_id,
            {"status": "draft", "stems": stems, "step": "", "step_detail": "", "error": ""},
        )
        shutil.rmtree(WORK / song_id, ignore_errors=True)
        print("  ready as a draft")
    except (PipelineError, guitar_split.JobRefused, DownloadError, requests.RequestException) as error:
        print(f"  failed: {error}")
        # The work folder is kept, so a retry does not pay MVSEP twice.
        db.update_song(song_id, {"status": "failed", "error": str(error)[:500]})


def next_song(db: Supabase, resume: bool) -> dict | None:
    """Claim the oldest waiting song. With `resume`, a song that a previous run
    left half-done comes first."""
    if resume:
        interrupted = db.songs(status="eq.processing", limit="1")
        if interrupted:
            return interrupted[0]
    for song in db.songs(status="eq.queued", limit="5"):
        claimed = db.update_song(song["id"], {"status": "processing", "error": ""}, status="eq.queued")
        if claimed:
            return claimed[0]
    return None


def run(db: Supabase, once: bool) -> None:
    print("Penia worker: watching for songs added on /admin. Ctrl-C to stop.")
    resume = True
    try:
        while True:
            song = next_song(db, resume)
            if song:
                process(db, song)
            else:
                resume = False
                if once:
                    print("Nothing is waiting.")
                    return
                time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print("\nStopped. A song that was mid-way continues the next time the worker starts.")


# --- Other commands ----------------------------------------------------------

def import_folder(db: Supabase, folder: Path, url: str, title: str, artist: str, publish: bool) -> None:
    """Upload a song folder made by guitar_split.py as a draft (or published) song."""
    files = guitar_split.find_stems(folder)
    if not files:
        sys.exit(f"error: {folder} needs these files: {', '.join(guitar_split.STEMS)}")
    files.update(guitar_split.find_stems(folder, (OLD_RHYTHM_STEM,)) or {})
    video = youtube_id(url)
    if db.songs(youtube_id=f"eq.{video}"):
        sys.exit(f"error: a song for video {video} is already on the site")
    song = db.insert_song({
        "youtube_id": video,
        "youtube_url": f"https://www.youtube.com/watch?v={video}",
        "slug": video.lower(),
        "title": title,
        "artist": artist,
        "status": "processing",
        "step": "upload",
    })
    details = describe(db, song, guitar_split.video_info(url))
    stems = upload_stems(db, song["id"], files)
    db.update_song(song["id"], {**details, "stems": stems, "status": "draft", "step": ""})
    if publish:
        db.update_song(song["id"], {"status": "published"})
    print(f"{'Published' if publish else 'Draft'}: {details['artist'] or '?'} - {details['title']}  (/songs/{details['slug']})")


def add_admin(db: Supabase, username: str) -> None:
    """Create (or reset the password of) an /admin login."""
    if not re.fullmatch(r"[a-z0-9._-]{2,32}", username):
        sys.exit("error: use 2-32 lower-case letters, digits, dots, dashes or underscores")
    email = f"{username}@{ADMIN_EMAIL_DOMAIN}"
    password = getpass.getpass(f"Password for {username}: ")
    if len(password) < 8:
        sys.exit("error: use at least 8 characters")
    if getpass.getpass("Repeat it: ") != password:
        sys.exit("error: the two passwords differ")

    users = f"{db.url}/auth/v1/admin/users"
    listed = db._check(db.http.get(users, params={"per_page": 1000}, timeout=30)).json()["users"]
    existing = next((user for user in listed if user.get("email") == email), None)
    if existing:
        user = db._check(db.http.put(f"{users}/{existing['id']}", json={"password": password}, timeout=30)).json()
        print(f"{username} already existed; the password was changed.")
    else:
        body = {"email": email, "password": password, "email_confirm": True}
        user = db._check(db.http.post(users, json=body, timeout=30)).json()
        print(f"Created {username}.")
    db._check(db.http.post(
        f"{db.url}/rest/v1/admins",
        json={"user_id": user["id"]},
        headers={"Prefer": "resolution=ignore-duplicates"},
        timeout=30,
    ))
    print("They can now sign in on /admin.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Penia worker: process songs added on the site.")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("run", help="keep watching for new songs (the default)")
    commands.add_parser("once", help="process the songs that are waiting, then stop")
    admin = commands.add_parser("add-admin", help="create an /admin login, or reset its password")
    admin.add_argument("username")
    imported = commands.add_parser("import", help="upload a song folder that was split earlier")
    imported.add_argument("folder", type=Path)
    imported.add_argument("--url", required=True, help="the song's YouTube link")
    imported.add_argument("--title", default="", help="song title (default: from the video)")
    imported.add_argument("--artist", default="", help="artist (default: from the video)")
    imported.add_argument("--publish", action="store_true", help="publish it right away")
    args = parser.parse_args()

    db = Supabase()
    try:
        if args.command == "add-admin":
            add_admin(db, args.username)
        elif args.command == "import":
            import_folder(db, args.folder, args.url, args.title, args.artist, args.publish)
        else:
            run(db, once=args.command == "once")
    except PipelineError as error:
        sys.exit(f"error: {error}")


if __name__ == "__main__":
    main()
