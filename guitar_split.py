#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp", "requests"]
# ///
"""Split a YouTube song into practice stems with MVSEP.

The split is one run of a preset saved on the MVSEP account (see PRESET_ID):
MVSEP's Lead/Rhythm Guitar model takes the bouzouki out, a vocal model takes
the singer out of what is left, and the rest is mixed into one backing.

    lead-guitar   the bouzouki
    vocals        the singer
    instruments   everything else, rhythm guitar included

The three files are saved in a folder named after the video. If they are
already there nothing is done, and a run that was submitted but not collected
is resumed, so re-running the same command never pays for the same song twice.

Usage:
    # The MVSEP token is read from the MVSEP_API_TOKEN environment variable,
    # or from a .env file next to this script.
    uv run guitar_split.py "https://www.youtube.com/watch?v=..."

    # Collect the run of a song folder that already exists:
    uv run guitar_split.py "stems/Song title"

worker.py imports this file and calls split_song() for songs added on the site.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable

import requests
import yt_dlp
from yt_dlp.utils import sanitize_filename

API = "https://mvsep.com/api"
JOBS_FILE = ".mvsep-jobs.json"  # per song folder: the run submitted but not yet collected

# The preset "mpouzouki", built in the editor at https://mvsep.com/presets.
# Presets are private to the MVSEP account that made them, so this id only
# works with that account's MVSEP_API_TOKEN. Its graph:
#
#   song -> MVSep Lead/Rhythm Guitar (two-stage)
#             lead guitar ------------------------------------> "lead-guitar"
#             no guitar -> BS PolarFormer (124 bands)
#                            vocals --------------------------> "vocals"
#                            instrumental + rhythm guitar ----> "instruments"
#                            (a Mix node, which adds the two)
#
# Each Output node of the preset is labelled with a name in STEMS and
# re-encodes to MP3 320 kbps. A run costs 2 credits per minute of audio.
PRESET_ID = 2644
STEMS = ("instruments", "lead-guitar", "vocals")


class PipelineError(Exception):
    """The song could not be split; the message says why."""


class JobFailed(Exception):
    """MVSEP reported that a job failed or no longer exists."""


class JobRefused(Exception):
    """MVSEP did not accept a new job (bad token, no credits left, ...)."""


# Called as report(step, detail) while a song is processed. step is
# "download" or "split"; detail is a line of progress text.
Report = Callable[[str, str], None]


def print_report(step: str, detail: str) -> None:
    print(f"  {detail}")


def load_env() -> None:
    """Read KEY=VALUE lines from the .env next to this script, if there is one.

    Variables that are already set in the environment win.
    """
    try:
        lines = (Path(__file__).parent / ".env").read_text().splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        key, sep, value = line.partition("=")
        if sep and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


def get_token() -> str:
    load_env()
    token = os.environ.get("MVSEP_API_TOKEN")
    if not token:
        raise PipelineError(
            "MVSEP_API_TOKEN is not set (put it in .env; your key is shown at https://mvsep.com/full_api)"
        )
    return token


# --- YouTube ---------------------------------------------------------------

YTDL_OPTIONS = {
    # m4a first: it needs no ffmpeg conversion and MVSEP accepts it.
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    "noplaylist": True,
    "quiet": True,
    "no_warnings": True,
}


def video_info(url: str) -> dict:
    """Title, id, duration (seconds) and uploader of a YouTube video."""
    with yt_dlp.YoutubeDL(YTDL_OPTIONS) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "id": info["id"],
        "title": info.get("title") or info["id"],
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel") or "",
    }


def download_audio(url: str, workdir: Path) -> Path:
    """Download the best audio track of a YouTube video."""
    options = {**YTDL_OPTIONS, "outtmpl": str(workdir / "%(id)s.%(ext)s")}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))
    if not path.exists():
        raise PipelineError(f"yt-dlp reported success but {path.name} is missing")
    return path


# --- MVSEP -----------------------------------------------------------------

def create_run(audio: Path) -> str:
    """Upload the audio and start a run of the preset. Returns the run's hash."""
    with audio.open("rb") as handle:
        response = requests.post(
            f"{API}/separation/create",
            data={"api_token": get_token(), "preset_id": PRESET_ID, "is_demo": 0},
            files={"audiofile": (audio.name, handle)},
            timeout=600,
        )
    try:
        body = response.json()
    except ValueError:
        raise PipelineError(f"MVSEP returned HTTP {response.status_code}: {response.text[:300]}")
    if not body.get("success"):
        # The reason is in "errors" (a list) or in data -> message, depending on the error.
        data = body.get("data")
        nested = data if isinstance(data, dict) else {}
        reasons = body.get("errors") or nested.get("errors") or nested.get("message") or body
        if isinstance(reasons, list):
            reasons = "; ".join(str(r) for r in reasons)
        raise JobRefused(str(reasons))
    return body["data"]["hash"]


def wait_for_result(
    job_hash: str, poll_seconds: int, timeout_seconds: int, report: Callable[[str], None]
) -> list[dict]:
    """Poll until the run is done. Returns its output files, one per Output
    node of the preset; each file's "type" is that node's label."""
    deadline = time.monotonic() + timeout_seconds
    last_line = None
    while True:
        # A preset run is only visible to the account that started it, so the
        # token goes along. That puts it in the URL, which requests quotes in
        # its error messages: report the kind of error, never its text.
        try:
            response = requests.get(
                f"{API}/separation/get",
                params={"hash": job_hash, "api_token": get_token()},
                timeout=60,
            )
            body = response.json()
        except (requests.RequestException, ValueError) as error:
            raise PipelineError(
                f"could not read the job's status from MVSEP ({type(error).__name__}). "
                "Run it again to collect the result."
            ) from None
        status = body.get("status")
        data = body.get("data") or {}

        if status == "done":
            return data["files"]
        if status in ("failed", "not_found") or not body.get("success", True):
            raise JobFailed(f"job {job_hash} {status}: {data.get('message', body)}")

        line = status or "unknown"
        if "current_order" in data:
            line += f" (position {data['current_order']} of {data.get('queue_count', '?')})"
        elif "finished_chunks" in data:
            line += f" ({data['finished_chunks']}/{data.get('all_chunks', '?')} chunks)"
        if line != last_line:
            report(line)
            last_line = line

        if time.monotonic() > deadline:
            raise PipelineError(
                f"gave up after {timeout_seconds}s; the job is still running. "
                "Run it again later to collect the result."
            )
        time.sleep(poll_seconds)


def save_stems(files: list[dict], out_dir: Path, report: Callable[[str], None]) -> dict[str, Path]:
    """Download the run's output files into out_dir as <stem name>.<ext>."""
    by_label = {str(f.get("type", "")).strip().lower(): f for f in files}
    missing = [name for name in STEMS if name not in by_label]
    if missing:
        raise PipelineError(
            f"the preset's result has no {', '.join(missing)} output; got {sorted(by_label)}"
        )
    picked = {name: by_label[name]["url"] for name in STEMS}

    out_dir.mkdir(parents=True, exist_ok=True)
    saved = {}
    for name, url in picked.items():
        target = out_dir / f"{name}{Path(url.split('?')[0]).suffix}"
        partial = target.with_name(target.name + ".part")
        with requests.get(url, stream=True, timeout=120) as response:
            response.raise_for_status()
            with partial.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1 << 20):
                    handle.write(chunk)
        partial.replace(target)
        report(f"saved {target}")
        saved[name] = target
    return saved


# --- Pipeline ----------------------------------------------------------------

def find_stems(folder: Path, names: tuple[str, ...] = STEMS) -> dict[str, Path] | None:
    """Return the saved file for every stem name, or None if any is missing."""
    found = {}
    for name in names:
        matches = [p for p in sorted(folder.glob(f"{name}.*")) if p.suffix != ".part"]
        if not matches:
            return None
        found[name] = matches[0]
    return found


def load_job(folder: Path) -> str | None:
    """The hash of the run that was submitted for this folder, if any."""
    try:
        return json.loads((folder / JOBS_FILE).read_text()).get("split")
    except (FileNotFoundError, ValueError, AttributeError):
        return None


def save_job(folder: Path, job_hash: str | None) -> None:
    path = folder / JOBS_FILE
    if job_hash:
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"split": job_hash}, indent=2) + "\n")
    else:
        path.unlink(missing_ok=True)


def split_song(
    url: str | None,
    folder: Path,
    *,
    poll: int = 10,
    timeout: int = 3600,
    report: Report = print_report,
) -> dict[str, Path]:
    """Split one song and return its three stem files by name.

    `url` may be None when the folder already has the stems or a submitted
    run. Nothing is done if the stems are in the folder, and a run that was
    submitted but not collected is resumed. Raises PipelineError when
    something goes wrong.
    """
    say = lambda detail: report("split", detail)
    existing = find_stems(folder)
    if existing:
        say(f"already in the folder ({', '.join(p.name for p in existing.values())}), skipping")
        return existing

    job_hash = load_job(folder)
    if job_hash:
        say(f"resuming run {job_hash}")
    else:
        if url is None:
            raise PipelineError(
                f"{folder} has no stems yet; give the YouTube URL instead of the folder"
            )
        with tempfile.TemporaryDirectory() as tmp:
            report("download", "downloading audio from YouTube...")
            audio = download_audio(url, Path(tmp))
            say(f"uploading {audio.stat().st_size / 1e6:.1f} MB to MVSEP...")
            try:
                job_hash = create_run(audio)
            except JobRefused as error:
                raise PipelineError(f"MVSEP refused the job: {error}") from error
        save_job(folder, job_hash)
        say(f"run: {job_hash}")

    say("waiting for the separation...")
    try:
        files = wait_for_result(job_hash, poll, timeout, say)
    except JobFailed as error:
        save_job(folder, None)
        raise PipelineError(f"{error}. Run it again to submit a new job.") from error
    saved = save_stems(files, folder, say)
    save_job(folder, None)
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split a YouTube song into lead-guitar, vocals and instruments "
        "stems with MVSEP."
    )
    parser.add_argument("source", help="YouTube video URL, or an existing song folder to finish")
    parser.add_argument("-o", "--output", default="stems", type=Path,
                        help="parent folder for results (default: ./stems)")
    parser.add_argument("--name", help="folder name to use instead of the video title")
    parser.add_argument("--poll", type=int, default=10, help="seconds between status checks")
    parser.add_argument("--timeout", type=int, default=3600,
                        help="seconds to wait for the separation (default: 3600)")
    args = parser.parse_args()

    try:
        if Path(args.source).is_dir():
            url = None
            folder = Path(args.source)
        else:
            url = args.source
            name = args.name or video_info(url)["title"]
            folder = args.output / sanitize_filename(name, restricted=False)
        print(f"Song folder: {folder}")
        split_song(url, folder, poll=args.poll, timeout=args.timeout)
    except PipelineError as error:
        sys.exit(f"error: {error}")
    print(f"Done: {folder.resolve()}")


if __name__ == "__main__":
    main()
