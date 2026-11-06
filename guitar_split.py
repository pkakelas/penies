#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp", "requests"]
# ///
"""Split a YouTube song into practice stems with MVSEP, in two steps:

  1. "MVSep Lead/Rhythm Guitar" (sep_type=101) on the song
       -> no-guitar, rhythm-guitar, lead-guitar
  2. MVSEP's best vocal model that the account may use (see VOCAL_MODELS)
     on the no-guitar stem
       -> vocals, instruments

All five files are saved in a folder named after the video. A step whose
files are already in that folder is skipped, and a job that was submitted
but not collected is resumed, so re-running the same command never pays
for the same separation twice.

Usage:
    # The MVSEP token is read from the MVSEP_API_TOKEN environment variable,
    # or from a .env file next to this script.
    uv run guitar_split.py "https://www.youtube.com/watch?v=..."

    # Finish the missing steps of a song folder that already exists:
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
OUTPUT_FORMATS = {"mp3": 0, "wav": 1, "flac": 2}  # output_format
JOBS_FILE = ".mvsep-jobs.json"  # per song folder: jobs submitted but not yet collected

# Each *_STEMS dict maps the file name to save -> the "type" labels MVSEP may
# give that output file.

# Step 1: MVSep Lead/Rhythm Guitar (lead-guitar, rhythm-guitar)
GUITAR_SEP_TYPE = 101
GUITAR_MODELS = {"two-stage": 0, "one-stage": 1}  # add_opt1
GUITAR_STEMS = {
    "no-guitar": ("no guitar",),
    "rhythm-guitar": ("rhythm guitar",),
    "lead-guitar": ("lead guitar",),
}

# Step 2: vocals / instrumental, run on the no-guitar stem.
# MVSEP's vocal models, best first, by the vocal SDR score MVSEP listed in
# November 2026 (their vocal ensemble scores 11.93). The top one is for
# premium accounts only; when MVSEP refuses a model as premium-only, the next
# one is tried. Each entry: (label, sep_type, add_opt1, supports overlap option).
VOCAL_MODELS = [
    ("BS Roformer, 124 bands (SDR vocals 12.33, premium only)", 40, 171, True),
    ("BS PolarFormer, 124 bands (SDR vocals 12.02)", 123, 163, False),
    ("BS Roformer, ver 2025.07 (SDR vocals 11.89)", 40, 81, True),
]
VOCAL_OVERLAPS = {"50": 2, "87.5": 8}  # add_opt2; 87.5% costs more
VOCAL_STEMS = {
    "vocals": ("vocals",),
    "instruments": ("instrumental", "instrum", "other"),
}


class PipelineError(Exception):
    """The song could not be split; the message says why."""


class JobFailed(Exception):
    """MVSEP reported that a job failed or no longer exists."""


class JobRefused(Exception):
    """MVSEP did not accept a new job (bad token, premium-only option, ...)."""


# Called as report(step, detail) while a song is processed. step is
# "download", "guitar" or "vocals"; detail is a line of progress text.
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

def create_separation(audio: Path, sep_type: int, options: dict, output_format: int) -> str:
    """Upload the audio and start a separation. Returns the job hash."""
    with audio.open("rb") as handle:
        response = requests.post(
            f"{API}/separation/create",
            data={
                "api_token": get_token(),
                "sep_type": sep_type,
                "output_format": output_format,
                "is_demo": 0,
                **options,
            },
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
    """Poll until the job is done. Returns the list of output files."""
    deadline = time.monotonic() + timeout_seconds
    last_line = None
    while True:
        response = requests.get(
            f"{API}/separation/get", params={"hash": job_hash}, timeout=60
        )
        body = response.json()
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


def save_stems(
    files: list[dict], stems: dict, out_dir: Path, report: Callable[[str], None]
) -> dict[str, Path]:
    """Download the wanted output files into out_dir as <stem name>.<ext>."""
    by_type = {str(f.get("type", "")).strip().lower(): f for f in files}
    picked = {}
    for name, labels in stems.items():
        match = next((by_type[label] for label in labels if label in by_type), None)
        if match is None:
            raise PipelineError(f"MVSEP result has no {labels[0]!r} output; got {sorted(by_type)}")
        picked[name] = match["url"]

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

def find_stems(folder: Path, stems: dict) -> dict[str, Path] | None:
    """Return the saved file for every stem name, or None if any is missing."""
    found = {}
    for name in stems:
        matches = [p for p in sorted(folder.glob(f"{name}.*")) if p.suffix != ".part"]
        if not matches:
            return None
        found[name] = matches[0]
    return found


def load_jobs(folder: Path) -> dict:
    try:
        return json.loads((folder / JOBS_FILE).read_text())
    except (FileNotFoundError, ValueError):
        return {}


def save_jobs(folder: Path, jobs: dict) -> None:
    path = folder / JOBS_FILE
    if jobs:
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(jobs, indent=2) + "\n")
    else:
        path.unlink(missing_ok=True)


def run_step(
    title: str,
    key: str,
    folder: Path,
    stems: dict,
    submit: Callable[[], str],
    poll: int,
    timeout: int,
    report: Report,
) -> dict[str, Path]:
    """Make sure the step's stems are in the folder; returns their paths."""
    say = lambda detail: report(key, detail)
    print(f"{title}:")
    existing = find_stems(folder, stems)
    if existing:
        say(f"already in the folder ({', '.join(p.name for p in existing.values())}), skipping")
        return existing

    jobs = load_jobs(folder)
    job_hash = jobs.get(key)
    if job_hash:
        say(f"resuming job {job_hash}")
    else:
        try:
            job_hash = submit()
        except JobRefused as error:
            raise PipelineError(f"MVSEP refused the job: {error}") from error
        jobs[key] = job_hash
        save_jobs(folder, jobs)
        say(f"job hash: {job_hash}")

    say("waiting for separation...")
    try:
        files = wait_for_result(job_hash, poll, timeout, say)
    except JobFailed as error:
        jobs.pop(key, None)
        save_jobs(folder, jobs)
        raise PipelineError(f"{error}. Run it again to submit a new job.") from error
    saved = save_stems(files, stems, folder, say)
    jobs.pop(key, None)
    save_jobs(folder, jobs)
    return saved


def split_song(
    url: str | None,
    folder: Path,
    *,
    output_format: str = "mp3",
    guitar_model: str = "two-stage",
    vocal_overlap: str = "50",
    poll: int = 10,
    timeout: int = 3600,
    report: Report = print_report,
) -> dict[str, Path]:
    """Run both steps for one song and return the five stem files by name.

    `url` may be None when the folder already has the guitar stems. Steps
    whose files are in the folder are skipped; a job that was submitted but
    not collected is resumed. Raises PipelineError when something goes wrong.
    """
    fmt = OUTPUT_FORMATS[output_format]

    def submit_guitar() -> str:
        if url is None:
            raise PipelineError(
                f"{folder} has no guitar stems yet; give the YouTube URL instead of the folder"
            )
        with tempfile.TemporaryDirectory() as tmp:
            report("download", "downloading audio from YouTube...")
            audio = download_audio(url, Path(tmp))
            report("guitar", f"uploading {audio.stat().st_size / 1e6:.1f} MB to MVSEP...")
            return create_separation(
                audio, GUITAR_SEP_TYPE, {"add_opt1": GUITAR_MODELS[guitar_model]}, fmt
            )

    guitar = run_step(
        "Step 1, lead/rhythm guitar", "guitar", folder, GUITAR_STEMS, submit_guitar,
        poll, timeout, report,
    )

    def submit_vocals() -> str:
        no_guitar = guitar["no-guitar"]
        size = f"{no_guitar.stat().st_size / 1e6:.1f} MB"
        for label, sep_type, model, has_overlap in VOCAL_MODELS:
            options = {"add_opt1": model}
            if has_overlap:
                options["add_opt2"] = VOCAL_OVERLAPS[vocal_overlap]
            report("vocals", f"uploading {no_guitar.name} ({size}) to MVSEP for {label}...")
            try:
                return create_separation(no_guitar, sep_type, options, fmt)
            except JobRefused as error:
                if "premium" not in str(error).lower():
                    raise
                report("vocals", "not available on this account (premium only), trying the next best model")
        raise JobRefused("every vocal model in VOCAL_MODELS is premium-only for this account")

    vocals = run_step(
        "Step 2, vocals from the no-guitar stem", "vocals", folder, VOCAL_STEMS, submit_vocals,
        poll, timeout, report,
    )
    return {**guitar, **vocals}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split a YouTube song into no-guitar, rhythm-guitar, lead-guitar, "
        "vocals and instruments stems with MVSEP."
    )
    parser.add_argument("source", help="YouTube video URL, or an existing song folder to finish")
    parser.add_argument("-o", "--output", default="stems", type=Path,
                        help="parent folder for results (default: ./stems)")
    parser.add_argument("--format", choices=OUTPUT_FORMATS, default="mp3",
                        help="stem file format (default: mp3 320 kbps)")
    parser.add_argument("--model", choices=GUITAR_MODELS, default="two-stage",
                        help="guitar model type (default: two-stage)")
    parser.add_argument("--vocal-overlap", choices=VOCAL_OVERLAPS, default="50",
                        help="vocal model overlap in percent; 87.5 is slower and "
                        "costs double (default: 50)")
    parser.add_argument("--name", help="folder name to use instead of the video title")
    parser.add_argument("--poll", type=int, default=10, help="seconds between status checks")
    parser.add_argument("--timeout", type=int, default=3600,
                        help="seconds to wait for each separation (default: 3600)")
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
        split_song(
            url, folder,
            output_format=args.format, guitar_model=args.model,
            vocal_overlap=args.vocal_overlap, poll=args.poll, timeout=args.timeout,
        )
    except PipelineError as error:
        sys.exit(f"error: {error}")
    print(f"Done: {folder.resolve()}")


if __name__ == "__main__":
    main()
