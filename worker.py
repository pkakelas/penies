#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp", "requests", "boto3"]
# ///
"""Penies worker: turns songs added on the site into playable drafts.

An admin adds a YouTube link on /admin, which creates a "queued" row in the
songs table. This worker picks the row up, asks Claude for the song's title,
singer, composer and first recording (from the video's title, description and
top comments), splits the song with MVSEP (guitar_split.py), uploads the stems
to the Cloudflare R2 bucket and marks the song as a draft. The admin then checks the details, tests it
and presses Publish.

Songs are only processed while this is running:

    uv run worker.py                      # keep watching for new songs
    uv run worker.py once                 # handle what is waiting, then stop

Other commands:

    uv run worker.py add-admin USERNAME   # create an /admin login (asks for a password)
    uv run worker.py import "stems/Song" --url "https://youtube.com/watch?v=..."
                                          # upload a song folder that was split earlier
    uv run worker.py to-r2 --delete-copies  # delete the old copies in Supabase Storage

Needs SUPABASE_URL, SUPABASE_SECRET_KEY, MVSEP_API_TOKEN, R2_ENDPOINT,
R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, from the environment or
from the .env file next to this script. The song's details
come from Claude Code (`claude -p`, signed in on this Mac); without it the
title and artist are only guessed from the video's title.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import boto3
import requests
from boto3.exceptions import S3UploadFailedError
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from yt_dlp.utils import DownloadError

import guitar_split
from guitar_split import PipelineError

ROOT = Path(__file__).parent
WORK = ROOT / "work"  # scratch: one folder per song id while it is processed
# Supabase Storage's bucket, where the stems were before R2. Only `to-r2` and
# deleting a song still look there, for the copies left behind.
BUCKET = "stems"
# Song folders split before the preset have the rhythm guitar as a file of
# its own instead of inside instruments. `import` uploads it too, and the
# site's player adds it to the backing.
OLD_RHYTHM_STEM = "rhythm-guitar"
CONTENT_TYPES = {".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac"}
# A song's stems never change, so a browser may keep them for good.
STEM_CACHE = "max-age=31536000, immutable"
# The R2 bucket that holds the stems, from .env.
R2_ENV = ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
# The player downloads the stems from the visitor's browser, which only takes
# them from another address if the bucket says so (CORS). The links are signed,
# so which page asks does not matter.
R2_CORS = [{"AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400}]
SITE = "https://www.penies.gr"
SONG_ID = re.compile(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")
# /admin logins are usernames; Supabase wants an email, so "maria" is stored as
# maria@<this domain>. Keep in sync with ADMIN_EMAIL_DOMAIN in web/src/lib/supabase.ts.
ADMIN_EMAIL_DOMAIN = "admin.penia.app"
POLL_SECONDS = 5
# How many of the video's top comments Claude reads for the song's details.
COMMENTS = 60
# Claude Code's model alias: the current Opus, on the account signed in here.
CLAUDE_MODEL = "opus"
CLAUDE_TIMEOUT = 600  # seconds
# Claude may look the song up on the web, and nothing else.
CLAUDE_TOOLS = "WebSearch,WebFetch"


class R2:
    """The Cloudflare R2 bucket that holds the stems, through its S3 API.

    Downloads from R2 cost nothing, which is why the stems are there and not
    in Supabase Storage. The bucket is private: the site's visitors get signed
    links from the database (stem_links), made with the same key as here.
    """

    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str) -> None:
        # What the database needs to sign links (see Supabase.share_r2).
        self.config = {"endpoint": endpoint, "bucket": bucket, "access_key": access_key, "secret_key": secret_key}
        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    @classmethod
    def from_env(cls) -> R2:
        endpoint, bucket, access_key, secret_key = (os.environ.get(name, "").strip() for name in R2_ENV)
        if not (endpoint and bucket and access_key and secret_key):
            sys.exit(f"error: set {', '.join(R2_ENV)} (see .env.example)")
        # Cloudflare shows the address with the bucket's name after it; only the host is wanted.
        address = urlsplit(endpoint if "://" in endpoint else f"https://{endpoint}")
        return cls(f"https://{address.netloc}", bucket, access_key, secret_key)

    def _call(self, what: str, function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except (BotoCoreError, ClientError, S3UploadFailedError) as error:
            raise PipelineError(f"R2 could not {what}: {error}") from None

    def upload(self, key: str, file: Path) -> None:
        extra = {
            "ContentType": CONTENT_TYPES.get(file.suffix.lower(), "application/octet-stream"),
            "CacheControl": STEM_CACHE,
        }
        self._call(f"take {key}", self.s3.upload_file, str(file), self.bucket, key, ExtraArgs=extra)

    def size(self, key: str) -> int | None:
        """The object's size in bytes, or None if it is not there."""
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=key)["ContentLength"]
        except ClientError as error:
            if error.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return None
            raise PipelineError(f"R2 could not look at {key}: {error}") from None
        except BotoCoreError as error:
            raise PipelineError(f"R2 could not look at {key}: {error}") from None

    def _list(self, **query) -> list[dict]:
        pages = self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, **query)
        return self._call("list the bucket", list, pages)

    def remove(self, song_id: str) -> None:
        """Delete whatever is under the song's folder."""
        for page in self._list(Prefix=f"{song_id}/"):
            for entry in page.get("Contents", []):
                self._call(f"delete {entry['Key']}", self.s3.delete_object, Bucket=self.bucket, Key=entry["Key"])

    def folders(self) -> list[str]:
        """The top-level folders: one per song id."""
        pages = self._list(Delimiter="/")
        return [prefix["Prefix"].rstrip("/") for page in pages for prefix in page.get("CommonPrefixes", [])]

    def allow_browsers(self) -> bool:
        """Let web pages download from the bucket. False if this key may not change the bucket's settings."""
        try:
            self.s3.put_bucket_cors(Bucket=self.bucket, CORSConfiguration={"CORSRules": R2_CORS})
        except ClientError as error:
            if error.response["Error"]["Code"] in ("AccessDenied", "Unauthorized", "403"):
                return False
            raise PipelineError(f"R2 could not save the bucket's CORS policy: {error}") from None
        except BotoCoreError as error:
            raise PipelineError(f"R2 could not save the bucket's CORS policy: {error}") from None
        return True


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
        self.r2 = R2.from_env()
        self._r2_shared = False

    def rpc(self, function: str, arguments: dict):
        response = self.http.post(f"{self.url}/rest/v1/rpc/{function}", json=arguments, timeout=30)
        return self._check(response).json() if response.content else None

    def share_r2(self) -> None:
        """Give the database the bucket and its key, with which it signs the
        site's download links (Vault secret `r2_stems`). Done on every start,
        so a key changed in .env reaches the site too."""
        if not self._r2_shared:
            self.rpc("set_r2_stems", {"config": self.r2.config})
            self._r2_shared = True

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

    def remove_stems(self, song_id: str) -> None:
        """Delete the song's stems, and its old copy in Supabase Storage if it has one."""
        self.remove_supabase_stems(song_id)
        self.r2.remove(song_id)

    def remove_supabase_stems(self, song_id: str) -> None:
        """Delete whatever is in Supabase's bucket under the song's folder."""
        listing = self._check(self.http.post(
            f"{self.url}/storage/v1/object/list/{BUCKET}",
            json={"prefix": song_id, "limit": 100},
            timeout=30,
        )).json()
        paths = [f"{song_id}/{entry['name']}" for entry in listing]
        if paths:
            self._check(self.http.delete(
                f"{self.url}/storage/v1/object/{BUCKET}", json={"prefixes": paths}, timeout=60
            ))

    def download(self, path: str, to: Path) -> None:
        """Save a stem from Supabase's old bucket as a file."""
        with self.http.get(f"{self.url}/storage/v1/object/{BUCKET}/{path}", stream=True, timeout=600) as response:
            self._check(response)
            with to.open("wb") as handle:
                for chunk in response.iter_content(1 << 20):
                    handle.write(chunk)

    def upload(self, path: str, file: Path) -> None:
        """Put a stem in R2."""
        self.share_r2()
        self.r2.upload(path, file)


# --- Titles --------------------------------------------------------

YOUTUBE_ID = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")
# Bits of a video title that are not part of the song's name.
TITLE_NOISE = re.compile(r"official|audio|video|lyrics|release|remaster|\bhd\b|\bhq\b|\b4k\b", re.I)


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


# --- Uploading ---------------------------------------------------------------

def upload_stems(db: Supabase, song_id: str, files: dict[str, Path], instrumental: bool) -> dict[str, str]:
    """Upload the stem files; an instrumental's vocals stem is left out.

    The preset always makes a vocals stem. For an instrumental it is only noise,
    and the player shows no vocals switch when a song has none.
    """
    paths = {}
    if instrumental:
        files = {name: file for name, file in files.items() if name != "vocals"}
    for name, file in files.items():
        paths[name] = f"{song_id}/{name}{file.suffix}"
        print(f"  uploading {file.name} ({file.stat().st_size / 1e6:.1f} MB)")
        db.upload(paths[name], file)
    return paths


# --- Song details ------------------------------------------------------------

# The columns Claude fills in; the admin corrects them on the draft's page.
DETAIL_FIELDS = ("title", "artist", "composer", "first_singer", "first_performed")


# What Claude's answer must look like (JSON Schema, given to `claude --json-schema`).
SONG_DETAILS_SCHEMA = {
    "type": "object",
    "properties": {field: {"type": "string"} for field in DETAIL_FIELDS},
    "required": list(DETAIL_FIELDS),
    "additionalProperties": False,
}


CLAUDE_INSTRUCTIONS = """\
You identify Greek songs for Penies, a site where bouzouki players practise over real recordings \
(rebetiko, laiko, smyrneiko and the like). You are given a YouTube video's title, channel, \
description and top comments. Fill in the song's entry in the site's catalogue:

- title: the song's name as Greek discographies write it, in Greek with accents, and nothing else \
  (no artist, no "official audio", no quotes, no year).
- artist: who sings in this recording; for an instrumental, who plays the lead. The channel is \
  usually a record label or an uploader, not a performer.
- composer: who wrote the music.
- first_singer: who sang it first, on its first recording; for an instrumental, who first played it. \
  When this recording is itself the first one, that is the artist.
- first_performed: when it was first recorded, as free text, usually just the year ("1936"). When \
  this recording is the first one, its own year.

Write names in Greek script the way they are usually written (Μάρκος Βαμβακάρης, Ρόζα Εσκενάζυ); \
several people are separated by commas. Start from what the video says and what you know of Greek \
discography, then search the web (in Greek) to confirm the composer and the first recording: \
discography databases, the song's Wikipedia page, record labels' pages. Comments often name the \
composer and the first recording, and are often wrong, so check them too. A field the sources do \
not settle stays empty (""). Never invent a name or a year.\
"""


def ask_claude(info: dict, instrumental: bool, report: guitar_split.Report) -> dict | None:
    """Claude's reading of the video: a dict of DETAIL_FIELDS, or None if it could not answer.

    Runs Claude Code headless (`claude -p`), so the call goes on the Claude
    account signed in on this Mac, not on API credits. It runs in the temp
    folder so the project's CLAUDE.md is not read, with web search and web
    fetch as its only tools and no saved session. Whatever goes wrong here
    only costs the details, never the song: the caller falls back to the
    video's title.
    """
    if not shutil.which("claude"):
        report("details", "Claude Code (claude) is not installed; guessing the title from the video")
        return None
    report("details", "asking Claude who wrote and sang it...")
    lines = [f"Video title: {info['title']}", f"Channel: {info['uploader'] or '?'}"]
    if instrumental:
        lines.append("The admin marked this video as an instrumental (no singer).")
    if info.get("description"):
        lines += ["", "Description:", info["description"]]
    if info.get("comments"):
        lines += ["", "Top comments:"] + [f"- {text}" for text in info["comments"]]
    command = [
        "claude", "-p", "--output-format", "json", "--json-schema", json.dumps(SONG_DETAILS_SCHEMA),
        "--system-prompt", CLAUDE_INSTRUCTIONS, "--model", CLAUDE_MODEL, "--effort", "high",
        "--tools", CLAUDE_TOOLS, "--allowedTools", CLAUDE_TOOLS, "--strict-mcp-config", "--no-session-persistence",
    ]
    try:
        run = subprocess.run(
            command, input="\n".join(lines), capture_output=True, text=True,
            cwd=tempfile.gettempdir(), timeout=CLAUDE_TIMEOUT,
        )
        answer = json.loads(run.stdout) if run.stdout.strip() else {}
    except subprocess.TimeoutExpired:
        report("details", "Claude took too long; guessing the title from the video")
        return None
    except (OSError, json.JSONDecodeError) as error:
        report("details", f"could not run Claude ({type(error).__name__}); guessing the title from the video")
        return None
    found = answer.get("structured_output")
    if run.returncode or answer.get("is_error") or not isinstance(found, dict):
        # `result` says why ("Not logged in · Please run /login", ...).
        why = str(answer.get("result") or run.stderr.strip() or f"exit code {run.returncode}")[:120]
        report("details", f"Claude gave no answer ({why}); guessing the title from the video")
        return None
    return {field: str(found.get(field) or "").strip() for field in DETAIL_FIELDS}


def describe(song: dict, info: dict, found: dict | None) -> dict:
    """What the songs row should say, from the video and from Claude's answer.

    Anything the admin already typed is kept; a field Claude left empty falls
    back to splitting the video's title. Setting the title also sets the
    song's address: the database makes the slug from it (see the
    song_slug_from_title migration).
    """
    artist, title = split_title(info["title"])
    guess = {"title": title, "artist": artist, "composer": "", "first_singer": "", "first_performed": ""}
    for field in DETAIL_FIELDS:
        guess[field] = song.get(field) or (found or {}).get(field) or guess[field]
    return {**guess, "duration_seconds": info.get("duration")}


def find_details(song: dict, report: guitar_split.Report) -> dict:
    """Read the video and ask Claude about it; see describe() for the result."""
    report("details", "reading the video's title and comments...")
    info = guitar_split.video_info(song["youtube_url"], comments=COMMENTS)
    found = None
    # A retry of a song whose details are all filled in asks nothing.
    if not all(song.get(field) for field in DETAIL_FIELDS):
        found = ask_claude(info, song.get("instrumental", False), report)
    return describe(song, info, found)


# --- Processing --------------------------------------------------------------


class SongGone(Exception):
    """The song's row was deleted (in /admin) while the worker was on it."""


def process(db: Supabase, song: dict) -> None:
    """Split one song and leave it as a draft, or as failed with the reason."""
    song_id = song["id"]
    print(f"\n{song['youtube_url']} ({song_id})")
    last = {}

    def update(fields: dict) -> dict:
        """Change the song; stops the work if its row is gone."""
        rows = db.update_song(song_id, fields)
        if not rows:
            raise SongGone
        return rows[0]

    def report(step: str, detail: str) -> None:
        print(f"  {detail}")
        if (step, detail) != (last.get("step"), last.get("detail")):
            last.update(step=step, detail=detail)
            update({"step": step, "step_detail": detail})

    try:
        details = find_details(song, report)
        slug = update(details)["slug"]
        print(f"  {details['artist'] or '?'} - {details['title']}  (/songs/{slug})")
        if details["composer"] or details["first_singer"]:
            print(f"  by {details['composer'] or '?'}, first sung by {details['first_singer'] or '?'} ({details['first_performed'] or '?'})")

        files = guitar_split.split_song(song["youtube_url"], WORK / song_id, report=report)
        report("upload", "uploading the stems...")
        stems = upload_stems(db, song_id, files, song.get("instrumental", False))
        update({"status": "draft", "stems": stems, "storage": "r2", "step": "", "step_detail": "", "error": ""})
        shutil.rmtree(WORK / song_id, ignore_errors=True)
        print("  ready as a draft")
    except SongGone:
        # Deleted in /admin meanwhile: drop what was made for it. A run already
        # submitted to MVSEP is paid for either way.
        print("  deleted in /admin meanwhile; dropping its files")
        shutil.rmtree(WORK / song_id, ignore_errors=True)
        db.remove_stems(song_id)
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


def drop_orphans(db: Supabase) -> None:
    """Delete from R2 the stems of songs that are gone.

    /admin deletes a song's row but cannot reach R2 (only the worker has its
    key), so the worker tidies up after it.
    """
    try:
        folders = [folder for folder in db.r2.folders() if SONG_ID.fullmatch(folder)]
        for start in range(0, len(folders), 50):
            some = folders[start:start + 50]
            kept = {row["id"] for row in db.songs(select="id", id=f"in.({','.join(some)})")}
            for song_id in some:
                if song_id not in kept:
                    print(f"  song {song_id} was deleted in /admin; deleting its stems from R2")
                    db.r2.remove(song_id)
    except (requests.RequestException, PipelineError) as error:
        # Nothing depends on it; the next round tries again.
        print(f"  could not tidy up R2 ({type(error).__name__})")


def run(db: Supabase, once: bool) -> None:
    print("Penies worker: watching for songs added on /admin. Ctrl-C to stop.")
    print(f"Stems go to R2 ({db.r2.bucket}).")
    db.share_r2()
    drop_orphans(db)
    resume = True
    try:
        while True:
            try:
                song = next_song(db, resume)
            except (requests.RequestException, PipelineError) as error:
                # Supabase dropped or refused a poll; it is transient, keep watching.
                print(f"  Supabase did not answer ({type(error).__name__}); trying again in {POLL_SECONDS} s")
                time.sleep(POLL_SECONDS)
                continue
            if song:
                process(db, song)
                drop_orphans(db)
            else:
                resume = False
                if once:
                    print("Nothing is waiting.")
                    return
                time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print("\nStopped. A song that was mid-way continues the next time the worker starts.")


# --- Other commands ----------------------------------------------------------

def import_folder(
    db: Supabase, folder: Path, url: str, title: str, artist: str, instrumental: bool, publish: bool
) -> None:
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
        "instrumental": instrumental,
        "status": "processing",
        "step": "upload",
    })
    details = find_details(song, guitar_split.print_report)
    stems = upload_stems(db, song["id"], files, instrumental)
    fields = {**details, "stems": stems, "storage": "r2", "status": "draft", "step": ""}
    slug = db.update_song(song["id"], fields)[0]["slug"]
    if publish:
        db.update_song(song["id"], {"status": "published"})
    print(f"{'Published' if publish else 'Draft'}: {details['artist'] or '?'} - {details['title']}  (/songs/{slug})")


def check_links(db: Supabase, song: dict) -> None:
    """Make sure a visitor's browser can download the song's stems from R2:
    the database signs a link for each, R2 accepts it and lets a web page read it."""
    links = db.rpc("stem_links", {"song_id": song["id"]})
    if not links or set(links) != set(song["stems"]):
        raise PipelineError("the database gave no links for the song (is the migration stems_in_r2 pushed?)")
    for name, link in links.items():
        allowed = None
        for _ in range(6):  # a new CORS policy takes a moment to apply
            try:
                response = requests.get(link, headers={"Range": "bytes=0-0", "Origin": SITE}, timeout=30)
            except requests.RequestException as error:
                # The link is in the exception's text; it must not be printed.
                raise PipelineError(f"could not reach R2 ({type(error).__name__})") from None
            if response.status_code not in (200, 206):
                raise PipelineError(f"R2 refused the site's link for {name} (HTTP {response.status_code})")
            allowed = response.headers.get("Access-Control-Allow-Origin")
            if allowed:
                break
            time.sleep(5)
        if not allowed:
            raise PipelineError(
                "the bucket does not let web pages download from it. In Cloudflare, open the bucket's "
                f"Settings, CORS Policy, and save: {json.dumps(R2_CORS)}"
            )


def move_to_r2(db: Supabase, delete_copies: bool) -> None:
    """Copy the stems that are still in Supabase Storage to R2, a song at a time.

    A song is switched over (`storage`) once its files are in R2 and the site's
    links to them work, so the site plays every song throughout and the copy
    can be stopped and run again. The copies in Supabase stay until
    --delete-copies.
    """
    db.share_r2()
    if not db.r2.allow_browsers():
        print("This key may not change the bucket's settings; the CORS policy is checked below.")

    songs = [song for song in db.songs(storage="eq.supabase") if song["stems"]]
    print(f"{len(songs)} song(s) to copy to R2 ({db.r2.bucket}).")
    for number, song in enumerate(songs, 1):
        print(f"{number}/{len(songs)} {song['title'] or song['youtube_id']}")
        with tempfile.TemporaryDirectory() as folder:
            for name, path in song["stems"].items():
                file = Path(folder) / Path(path).name
                db.download(path, file)
                db.r2.upload(path, file)
                if db.r2.size(path) != file.stat().st_size:
                    raise PipelineError(f"{path} did not arrive whole in R2")
                print(f"  {name} ({file.stat().st_size / 1e6:.1f} MB)")
        db.update_song(song["id"], {"storage": "r2"})
        try:
            check_links(db, song)
        except PipelineError:
            db.update_song(song["id"], {"storage": "supabase"})  # the site goes on playing it from Supabase
            raise
    print("Every song with stems is in R2.")

    if not delete_copies:
        print("The copies in Supabase Storage are still there; `to-r2 --delete-copies` removes them.")
        return
    moved = [song for song in db.songs(storage="eq.r2") if song["stems"]]
    answer = input(f"Delete the Supabase copies of {len(moved)} song(s)? R2 then has the only ones. [y/N] ")
    if answer.strip().lower() != "y":
        return
    for song in moved:
        if any(db.r2.size(path) is None for path in song["stems"].values()):
            raise PipelineError(f"{song['title']} is not whole in R2; nothing of it was deleted")
        check_links(db, song)
        db.remove_supabase_stems(song["id"])
    print("Deleted.")


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
    parser = argparse.ArgumentParser(description="Penies worker: process songs added on the site.")
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
    imported.add_argument("--instrumental", action="store_true", help="no singer: the vocals stem is left out")
    imported.add_argument("--publish", action="store_true", help="publish it right away")
    moved = commands.add_parser("to-r2", help="copy the stems still in Supabase Storage to R2")
    moved.add_argument("--delete-copies", action="store_true", help="then delete them from Supabase (asks first)")
    args = parser.parse_args()

    db = Supabase()
    try:
        if args.command == "add-admin":
            add_admin(db, args.username)
        elif args.command == "import":
            import_folder(db, args.folder, args.url, args.title, args.artist, args.instrumental, args.publish)
        elif args.command == "to-r2":
            move_to_r2(db, args.delete_copies)
        else:
            run(db, once=args.command == "once")
    except PipelineError as error:
        sys.exit(f"error: {error}")


if __name__ == "__main__":
    main()
