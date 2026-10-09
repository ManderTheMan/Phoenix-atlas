# Archive tool

Years of videos sit on computers and drives, and in Google Takeout zips. Most aren't training, and the ones that are can be far too big to upload anywhere. This tool goes through all of them **on your own computer** (or home server):

1. finds every video in the folders and zips you give it, without unzipping anything first;
2. works out when each one was filmed: from Google's Takeout notes, the file itself or its name;
3. looks at about one frame a second to sort them: is someone in shot, big enough, and how many people?
4. tracks the joints in the usable clips with **the same pose model and settings as the app**, and saves a small copy of each (480p, no sound, no location or device details);
5. writes an index, a spreadsheet and a page you can browse, then packs the results for Phoenix Atlas.

Nothing is uploaded. The tool reads your videos and never changes or deletes them.

A minute of 1080p footage becomes about 0.25 MB of joint tracking and 1–3 MB of small copy. That's how ten years of footage fits in the app, and how the tracking alone can be shared.

## Set up (once)

You need **Python 3.10–3.13 (64-bit)** and **ffmpeg**. Run these in a terminal from the `Phoenix-atlas` folder.

**Windows** (PowerShell):

```powershell
winget install Python.Python.3.12
winget install Gyan.FFmpeg
# close and reopen the terminal, then:
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install .\tools\archive
```

**macOS** ([Homebrew](https://brew.sh)):

```bash
brew install python@3.12 ffmpeg
python3.12 -m venv .venv
source .venv/bin/activate
pip install ./tools/archive
```

**Linux** (Debian/Ubuntu):

```bash
sudo apt install python3-venv ffmpeg libegl1 libgles2
python3 -m venv .venv
source .venv/bin/activate
pip install ./tools/archive
```

The first run downloads the pose model (9 MB) and checks it against its fingerprint. Next time, start by activating the environment again (`.venv\Scripts\activate` or `source .venv/bin/activate`).

## Try it on a few videos

```bash
phoenix-archive run "D:\Videos" "D:\Takeout" --out "D:\phoenix-archive" --limit 20
```

- Give it as many folders, zip files or single videos as you like. Folders are searched all the way down, zips included.
- **Takeout zips don't need unzipping.** Point it at the folder they're in. Split exports (`takeout-…-001.zip`, `-002.zip`, …) are fine: a video and its date note are matched even when they ended up in different parts.
- Keep `--out` **outside** the Phoenix-atlas folder. The repository is public, and the results include your file names and small copies of your videos.

Then open `D:\phoenix-archive\report.html` in a browser. It shows every clip by year, with why anything was skipped. Tap a usable clip to watch its small copy.

## The overnight run

Leave out `--limit`:

```bash
phoenix-archive run "D:\Videos" "D:\Takeout" --out "D:\phoenix-archive"
```

- **Stop whenever you like** with Ctrl+C. Clips in progress finish first; press Ctrl+C again to stop at once. Run the same command again later and it carries on: finished videos are skipped, even if you add more folders.
- **Newest first** by default (`--order oldest` for the other way). Use `--since 2019` or `--until 2020-06` to do a period first.
- **Keep the computer awake and plugged in.** On Windows, use Settings → System → Power → Sleep: Never (when plugged in). On a Mac, put `caffeinate -i` before the command. On Linux, put `systemd-inhibit` before the command.
- Each line shows the date, length, file and result, plus an estimate of the time left.

`phoenix-archive status --out "D:\phoenix-archive"` shows the counts so far at any time. Add `--errors` to list files that couldn't be read (usually damaged files).

### How long it takes

Measured on a small 4-core machine: one worker tracked a minute of 1080p in 23 s. By default the tool runs one worker for every two CPU cores. Skipped clips take a few seconds each, because only the sorting look happens.

| Computer | Roughly, per hour of usable footage (first row measured, the others estimated) |
| --- | --- |
| 4-core laptop (2 workers) | 15–25 min |
| 8-core laptop (4 workers) | 8–12 min |
| 16-core server (8 workers) | 4–6 min |

H.265/HEVC phone video and 4K take longer to decode. Each worker uses about 0.5 GB of memory. Set the number of workers yourself with `--workers 6`.

## On the home server

The server needs to see the videos, for example through a network share. Docker is the easiest way to run it there:

```bash
docker build -t phoenix-archive tools/archive
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v /srv/videos:/videos:ro -v /srv/phoenix-archive:/out \
  phoenix-archive run /videos --out /out --workers 8
```

The videos are mounted read-only (`:ro`). The model is built into the image. Use the same `run`, `status` and `pack` commands as above.

**Laptop and server together** (optional): give both the same video folder, then split the work. Each machine writes to its own `--out` folder, and you merge them afterwards:

```bash
# laptop
phoenix-archive run "Z:\videos" --out "D:\archive-laptop" --shard 1/2
# server
docker run … phoenix-archive run /videos --out /out --shard 2/2
# afterwards, with both folders on one machine
phoenix-archive merge D:\archive-laptop D:\archive-server --out D:\phoenix-archive
```

Never point two runs at the same `--out` folder; the tool refuses if you try. If only the server can see everything, just run it all there.

## What comes out

```
phoenix-archive/
  report.html        browse everything by year
  index.csv          one row per clip, for a spreadsheet
  index.jsonl        the same, with everything known about each clip
  archive.json       tool and model versions, counts
  clips/<id>/
    clip.json        this clip's details: dates, sorting result, where its copies are
    track.json.gz    joint tracking, in the app's format (usable clips)
    proxy.mp4        the small copy (usable clips)
    thumb.jpg
  packs/             zips made by `pack`
  state.sqlite       what's been done, so runs can carry on
```

A clip's id is the start of its SHA-256 fingerprint. The same video found in two places (say on the laptop and inside a Takeout zip) is done once, and its `copies` lists both.

## Into Phoenix Atlas

```bash
phoenix-archive pack --out "D:\phoenix-archive"
```

This writes zips of up to 2 GB to `D:\phoenix-archive\packs`, holding usable clips without the near-duplicate copies. In the app, open **Media → Dataset → Import archive** and choose them. To make zips by period instead, add `--since 2019 --until 2019`.

**Tracking only:** `pack --tracks-only` leaves the small copies out, so you get joints, thumbnails and the index only. Even years of clips come to tens of MB. That's small enough to send for analysis or to share without any video.

## How it decides

**Sorting.**
- **Skipped:** a person is in fewer than 30% of the sampled frames ("no person" or "rarely in view"), or the person is under a fifth of the frame height ("too small"; `--min-size` changes this).
- **Usable:** everything else is tracked.
- Clips with two or more people are kept and labelled; the largest person is tracked, as in the app.

**Dates**, most trusted first:
1. Google Takeout's note (`photoTakenTime`);
2. the recording time inside the file;
3. a date in the file name (`VID_20190312_123456`, `PXL_…`, `20190312_123456`, `WhatsApp Video 2019-03-12 at …`, `Screen_Recording_…`);
4. the file's modified time.

The index records which one was used (`dateSource`). Copies lend each other their best date.

**Copies.**
- **Exact copies** have the same fingerprint and are done once.
- **Near-duplicates** are the same footage re-saved, re-encoded, shrunk or rotated by another app. The tool spots them by matching length, frames and joint positions all the way through. The best copy keeps its place, and the others get `nearDuplicateOf` and are left out of packs.
- The test is deliberately strict. On test clips, copies stayed within 0.4% of the frame in joint position. Two different sets of the same squat filmed identically were 1.4% or more apart, and are kept apart. Missing a copy only costs a little space, while merging two sets would hide one.

**Slow motion** is marked (`slowmo`). Some phones store slow motion stretched out, which stretches rep timings too.

## Matching the app

The tool uses the same MediaPipe model file (checked by SHA-256), version (1.1.0) and settings. It also uses the same frame rate (15 a second, 10 for clips over 45 s), the same rule for picking the person, and the same output format and rounding. So tracks made here and in the browser can be compared directly.

On the app's synthetic squat clips, landmarks from the two agreed to within 0.5% of the frame:
- **Still frames:** knee angles agreed within about 1°.
- **Mid-movement:** they differed by a few degrees. Most of that comes from the browser seeking to slightly different moments.
- **Bottom of the squat:** the tool's knee angle was 45.4° against a true 45.9°.

## Privacy

- Everything stays on the machines you run it on.
- Small copies and thumbnails carry no sound or metadata (no GPS, no device).
- Takeout notes are read for the date and description only; their location is ignored.
- `index.*`, `clip.json` and `report.html` contain your file names and folder names. They're for you, not for publishing. The app's dataset export decides what gets shared.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ffmpeg wasn't found` | Install it (see Set up) and open a new terminal. |
| `libEGL.so.1: cannot open shared object file` | `sudo apt install libegl1 libgles2` (Linux). |
| The model won't download (often certificates on macOS) | Run "Install Certificates.command" in the Python folder under Applications, or download the model in a browser and pass `--model path/to/pose_landmarker_full.task`. |
| `Another run is using …` | Another run is going, or one stopped less than two minutes ago. Use a different `--out`, or wait two minutes. |
| Lots of "person too small" | Filmed from far away. Try `--min-size 0.12` with `--redo`, and check the result in report.html. |

## Tests

```bash
pip install "./tools/archive[test]"
pytest tools/archive/tests
```

The end-to-end tests run the whole pipeline on a 5-second render of the app's 3D body squatting (`tests/fixtures/squat.mp4`). It goes through as a plain file, a copy inside a Takeout zip, a rotated re-encode, and next to a clip with nobody in it.
