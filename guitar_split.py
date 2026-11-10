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

The guitar model needs about ten seconds of music before it can tell the
bouzouki from the backing; whatever comes first is shared out evenly between
the two, and the same happens over the last few seconds. So the upload gets
PAD_SECONDS of the song itself (from a third of the way in) at either end, and
those stretches are cut off the stems afterwards (which re-encodes them, to AAC
in .m4a files, with afconvert: there is no ffmpeg on the Mac).

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
import subprocess
import sys
import tempfile
import time
import wave
from array import array
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

# The Lead/Rhythm Guitar model takes about ten seconds of music to settle on
# which part is the lead: until then it gives half of the bouzouki to each of
# its outputs (and silence in front does not count, it only delays the moment),
# and it loses the thread again over the last seconds of the file. So
# PAD_SECONDS of the song itself go in front of the upload and again at its end,
# faded where they meet the song so that each cut is in silence, and are cut
# off the stems again. They are taken from a third of the way in: there the
# parts play their usual roles, while the intro is the very bit the model
# cannot make up its mind about (a copy of it in front still left a quiet
# bouzouki in the backing). Measured on runs of the preset: 20 s of such music
# in front gave a clean intro, 15 s of silence made the muddled part longer.
PAD_SECONDS = 20
PAD_FADE_SECONDS = 0.5
# Everything is decoded to this rate, so that the cut lands on the same sample
# in the upload and in every stem.
SAMPLE_RATE = 44100
# The trimmed stems: AAC, which every browser decodes, at this bit rate.
STEM_SUFFIX = ".m4a"
STEM_BITRATE = 256_000


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


# --- Audio -----------------------------------------------------------------
# All through afconvert, which every Mac has: it decodes what YouTube and MVSEP
# send (AAC, MP3, FLAC...) and encodes AAC.

def afconvert(source: Path, target: Path, *options: str) -> None:
    try:
        subprocess.run(
            ["afconvert", *options, str(source), str(target)],
            check=True, capture_output=True, text=True,
        )
    except FileNotFoundError:
        raise PipelineError("afconvert is missing; this pipeline runs on a Mac") from None
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip().splitlines()
        raise PipelineError(
            f"afconvert could not convert {source.name}: {detail[-1] if detail else error.returncode}"
        ) from None


def decode(source: Path, target: Path) -> None:
    """Decode an audio file to 16-bit WAV at SAMPLE_RATE, keeping its channels."""
    afconvert(source, target, "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}")


def pad_audio(audio: Path, target: Path) -> int:
    """Write `audio` as a WAV with PAD_SECONDS of itself (from a third of the way
    in) in front and again at the end, faded where they meet the song. Returns
    the number of frames added at each end, to cut off the stems later. A song
    shorter than the pad is used whole."""
    decoded = target.with_suffix(".decoded.wav")
    decode(audio, decoded)
    with wave.open(str(decoded), "rb") as source:
        channels, width, rate = source.getnchannels(), source.getsampwidth(), source.getframerate()
        frames = source.getnframes()
        song = source.readframes(frames)
    decoded.unlink()
    if (width, rate) != (2, SAMPLE_RATE):
        raise PipelineError(f"unexpected decode of {audio.name}: {width * 8}-bit at {rate} Hz")

    pad_frames = min(frames, PAD_SECONDS * rate)
    start = min(frames // 3, frames - pad_frames)
    pad = song[start * channels * width : (start + pad_frames) * channels * width]
    with wave.open(str(target), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(width)
        out.setframerate(rate)
        out.writeframes(faded(pad, channels, "out") + song + faded(pad, channels, "in"))
    return pad_frames


def faded(pcm: bytes, channels: int, end: str) -> bytes:
    """16-bit PCM faded "in" at its start or "out" at its end, over PAD_FADE_SECONDS.

    A squared ramp, so that the faded end is as good as silent and the cut back
    to the song is not heard; the outermost 50 ms are silent outright."""
    samples = array("h", pcm)
    frames = len(samples) // channels
    fade = min(frames, int(PAD_FADE_SECONDS * SAMPLE_RATE))
    silent = min(fade, SAMPLE_RATE // 20)
    for i in range(fade):  # i: distance from the faded end
        gain = ((i - silent) / (fade - silent)) ** 2 if i >= silent else 0
        frame = frames - 1 - i if end == "out" else i
        for c in range(channels):
            samples[frame * channels + c] = int(samples[frame * channels + c] * gain)
    return samples.tobytes()


def trim_stem(stem: Path, target: Path, pad_frames: int) -> None:
    """Cut `pad_frames` off both ends of a stem MVSEP made and save it as AAC.

    MVSEP's MP3 may be a few milliseconds longer or shorter than the upload, so
    the cut at the end can be off by that much; the pad there is faded in from
    silence, so what is left of it is not heard."""
    with tempfile.TemporaryDirectory() as tmp:
        decoded = Path(tmp) / "stem.wav"
        trimmed = Path(tmp) / "trimmed.wav"
        decode(stem, decoded)
        with wave.open(str(decoded), "rb") as source, wave.open(str(trimmed), "wb") as out:
            out.setparams(source.getparams())
            out.setnframes(0)
            keep = max(0, source.getnframes() - 2 * pad_frames)
            source.setpos(min(pad_frames, source.getnframes()))
            out.writeframes(source.readframes(keep))
        afconvert(trimmed, target, "-f", "m4af", "-d", "aac", "-b", str(STEM_BITRATE))


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
    """Download the run's output files into out_dir as <stem name>.<ext>, as MVSEP made them."""
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


def load_job(folder: Path) -> tuple[str, int] | None:
    """The run submitted for this folder and the frames padded at each end of
    its upload (0 for a run from before the padding), if any."""
    try:
        job = json.loads((folder / JOBS_FILE).read_text())
        return (job["split"], int(job.get("pad_frames", 0))) if job.get("split") else None
    except (FileNotFoundError, ValueError, TypeError, KeyError):
        return None


def save_job(folder: Path, job_hash: str | None, pad_frames: int = 0) -> None:
    path = folder / JOBS_FILE
    if job_hash:
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"split": job_hash, "pad_frames": pad_frames}, indent=2) + "\n")
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

    job = load_job(folder)
    if job:
        job_hash, pad_frames = job
        say(f"resuming run {job_hash}")
    else:
        if url is None:
            raise PipelineError(
                f"{folder} has no stems yet; give the YouTube URL instead of the folder"
            )
        with tempfile.TemporaryDirectory() as tmp:
            report("download", "downloading audio from YouTube...")
            audio = download_audio(url, Path(tmp))
            say(f"putting {PAD_SECONDS} s of the song at either end, for the guitar model to settle on")
            upload = Path(tmp) / "upload.wav"
            pad_frames = pad_audio(audio, upload)
            say(f"uploading {upload.stat().st_size / 1e6:.1f} MB to MVSEP...")
            try:
                job_hash = create_run(upload)
            except JobRefused as error:
                raise PipelineError(f"MVSEP refused the job: {error}") from error
        save_job(folder, job_hash, pad_frames)
        say(f"run: {job_hash}")

    say("waiting for the separation...")
    try:
        files = wait_for_result(job_hash, poll, timeout, say)
    except JobFailed as error:
        save_job(folder, None)
        raise PipelineError(f"{error}. Run it again to submit a new job.") from error
    # The run's files stay on MVSEP for a while, so the job is only forgotten
    # once the trimmed stems are in the folder.
    folder.mkdir(parents=True, exist_ok=True)
    saved = {}
    with tempfile.TemporaryDirectory() as tmp:
        raw = save_stems(files, Path(tmp), lambda line: None)
        say(f"cutting {pad_frames / SAMPLE_RATE:.1f} s off either end of the stems...")
        for name, file in raw.items():
            target = folder / f"{name}{STEM_SUFFIX}"
            trim_stem(file, target, pad_frames)
            say(f"saved {target}")
            saved[name] = target
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
