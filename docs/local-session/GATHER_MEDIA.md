# Gathering your lifting videos and photos

This is a plan for a **Claude Code session on your own computer**. It searches your folders, drives and Google Takeout zips for training videos and photos, keeps their metadata, and turns them into datasets for Phoenix Atlas. Claude does the work with the archive tool (`tools/archive`); you answer a few questions and approve the long steps.

## For you: starting the session

1. **Get the latest code** on the computer that has your videos:
   ```bash
   git clone https://github.com/ManderTheMan/Phoenix-atlas.git   # or, in an existing clone: git fetch
   cd Phoenix-atlas
   git checkout ccr-f981213b-8jxzyw   # until it's merged; afterwards use main
   ```
2. **Pick a drive for the results** with room to spare. The archive is small: about 2–4 MB per minute of usable video and 0.5 MB per photo. Copies of the originals, if you want them, take as much space as the originals do.
3. **Plug the laptop in.** The full run can take a night or more.
4. **Start Claude Code** in the `Phoenix-atlas` folder (`claude`) and say:
   > Follow docs/local-session/GATHER_MEDIA.md

   Leave permissions on their default setting so Claude asks before running commands. Approving the `phoenix-archive` commands as they come up is enough.

**Privacy.** The videos, photos and their metadata stay on your computer. The tool uploads nothing, and the results go to the drive you choose, outside the public repository. One exception: to label clips, Claude looks at **contact sheets** (small numbered thumbnails). Like everything else in a Claude Code conversation, those images are sent to Anthropic to be processed. If you'd rather they weren't, say so at the start: Claude will make the sheets, and you'll label them yourself in the spreadsheet.

---

## For Claude: the plan

You're helping the user turn about ten years of their own footage into training data. The goal is five things, all in one **output root** outside the repository:

- `archive/`: the archive tool's results (joint tracks, small copies, index, report, full metadata);
- `review/`: your labels (keep, purpose, pattern, variant, pose, note), in CSV batches;
- `collected/`: untouched copies of the originals that are worth keeping, by year, each with a `.phoenix.json` describing it;
- `packs/`: zips to import into the app (Media → Archive);
- `SUMMARY.md`: what was searched, what was found, what's left to do.

`tools/archive/README.md` documents every command used here. Read it first.

### Ground rules

These apply throughout. Don't break them, even to work around an error.

1. **Sources are read-only.** Never move, rename, delete, edit, re-encode, re-tag or unzip anything inside the folders and zips the user names. Don't run `rm`, `del`, `Remove-Item`, `mv`, `ren` or `exiftool` against them, and don't change file times. The tool only ever reads them. Every file you write goes under the output root.
2. **Nothing personal goes in the repository.** It's public. Don't create the output root inside it, and don't copy media, thumbnails, sheets, CSVs, labels, logs or summaries into it. Never run `git add`, `git commit` or `git push` in this session. Before finishing, run `git status` in the repository and confirm nothing new appeared, apart from `.venv/`, which is ignored.
3. **Stay on this computer.** Don't send media or metadata to any website or API. Viewing contact sheets with your Read tool is the one agreed exception, and only if the user agreed to it at the start.
4. **Ask before anything big.** Get a go-ahead, with your estimate, before the full run (hours), before collecting originals (disk space) and before changing system settings such as sleep. Install Python packages only into the repository's `.venv`. Install system software (Python, ffmpeg) only after asking.
5. **Treat the data with care.** The metadata (camera, times, GPS locations, Takeout notes) is kept on purpose, because the user wants it, but only under the output root. Intimate or unrelated private photos are labelled `keep=no` with the note `private`. Don't describe them anywhere.

Adapt the commands below to the shell you're in. They are written for PowerShell with Windows paths; on macOS or Linux use `/` paths, `source .venv/bin/activate` and `tail` instead of `Get-Content -Tail`. `OUT` stands for the output root and `ARCH` for `OUT\archive`.

### Step 0: Ask (one message)

Ask these together, suggesting answers where you can:

1. **Where to search.** List every folder, drive and zip, including the Takeout zips. Check whether there's anything to leave out, such as work or family archives.
2. **Where to put the results.** Suggest `<a roomy drive>\phoenix-gather` and check the free space with `Get-PSDrive` or `df -h`.
3. **Photos too?** The default is yes. If many photos are HEIC, from an iPhone, HEIC support gets installed.
4. **Whose training?** Only the user's own, or friends' and clients' clips and saved videos of other lifters as well? The default is the user's own plus anyone they filmed while coaching. Downloaded videos of other athletes get `keep=no` unless the user says otherwise.
5. **Contact sheets.** Can you look at them to label clips, or will the user label them?
6. **Compute.** How long can the laptop run? Is the home server available, and can it see the same files?

### Step 1: Survey (read only)

1. Check the tools: `py -3.12 --version` (or `python3 --version`; 3.10–3.13 works) and `ffmpeg -version`. If either is missing, show the install line from the README's Set up section and ask before running it.
2. Set up the tool, which installs only into `.venv`:
   ```powershell
   py -3.12 -m venv .venv
   .venv\Scripts\activate
   pip install ".\tools\archive[heic]"
   phoenix-archive model
   ```
3. Count what's there without processing anything:
   ```powershell
   phoenix-archive run "D:\Videos" "D:\Takeout" "E:\Phone backup" --out "OUT\archive" --photos --dry-run
   ```
   It prints how many videos and photos it found, how many are inside zips, how many have Takeout dates, and roughly how many hours of footage there are.
4. Tell the user what you found, as a short list:
   - counts and sizes per source;
   - a time estimate from the README's "How long it takes" table (sorting skipped files is quick; tracking usable footage is the slow part);
   - expected sizes for the archive and, if wanted, for the collected originals;
   - anything odd, such as sources that weren't found or unreadable zips.

### Step 2: Trial run

Try about 40 files, and check the results before committing a night to it:

```powershell
phoenix-archive run <same sources> --out "OUT\archive" --photos --keep-metadata --limit 40
phoenix-archive sheets --out "OUT\archive" --which all
```

Check four things:

- **Sorting.** Look at the sheets in `OUT\archive\sheets\`. Usable tiles should show someone training. Skipped tiles show the reason in their caption. If lifting clips come out "person too small in the frame" (the camera was far away), suggest `--min-size 0.12` for the full run.
- **Dates.** Open `OUT\archive\index.csv` and look at the `dateSource` column. `takeout` and `metadata` are good; `filename` is fine; many `file` dates mean those copies lost their dates.
- **Metadata.** Pick a usable clip id and confirm that `OUT\archive\clips\<id>\meta.json` exists.
- **Errors.** Run `phoenix-archive status --out "OUT\archive" --errors`.

Report what you saw in a few lines, then ask whether to start the full run.

### Step 3: The full run

The full run takes hours. Start it so that it outlives this conversation and the user can watch it. Send its output to `OUT\run.log`. The run is resumable: running the same command again carries on where it stopped, and finished files are skipped.

**Windows.** Write the command into a script, then open it in its own window:

```powershell
Set-Content "OUT\run-archive.ps1" @'
& "<repo>\.venv\Scripts\phoenix-archive.exe" run "D:\Videos" "D:\Takeout" --out "OUT\archive" --photos --keep-metadata *>&1 | Tee-Object -FilePath "OUT\run.log" -Append
'@
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', 'OUT\run-archive.ps1'
```

Before starting, ask the user to set Settings → System → Power → Sleep to Never when plugged in. You can do it with `powercfg /change standby-timeout-ac 0` if they agree. Note the old value so it can be put back.

**macOS:**

```bash
nohup caffeinate -i .venv/bin/phoenix-archive run ... --out OUT/archive --photos --keep-metadata >> OUT/run.log 2>&1 &
```

On Linux, put `systemd-inhibit` in place of `caffeinate -i`.

**The home server** (optional, for large collections). Follow the README's "On the home server" section:
- run Docker with the sources mounted read-only (`:ro`);
- split the work with `--shard 1/2` on the laptop and `--shard 2/2` on the server;
- give each its own `--out` folder;
- afterwards, run `phoenix-archive merge` into `OUT\archive`.

**Checking progress.** Run `phoenix-archive status --out "OUT\archive"` and `Get-Content "OUT\run.log" -Tail 20`. Each line of the log shows the date, length, file and result, plus the time left. If the session ends while the run goes on, the next session picks up from here: check status first.

### Step 4: Look and label

Once the run is finished (or a good part of it, by year), make the sheets:

```powershell
phoenix-archive sheets --out "OUT\archive" --unreviewed
```

Each sheet has 18 numbered tiles. Each tile shows three frames of a video, or the photo, with the date, its length and what the tool saw. `OUT\archive\sheets\sheets.csv` maps each number to its clip. `--unreviewed` leaves out what's already labelled, so you can stop and start again whenever you like. The numbers change each time you run `sheets`, so label against the current `sheets.csv`.

**How to work.** Work in batches of about 5 sheets (90 clips):

1. View each sheet image.
2. Write one CSV per batch, `OUT\review\labels-001.csv`, `labels-002.csv` and so on, with the columns `number,keep,purpose,pattern,variant,pose,note`. Leave a cell empty when you don't know: empty cells change nothing.
3. Read the batch in straight away, so no work is lost:
   ```powershell
   phoenix-archive label --out "OUT\archive" "OUT\review\labels-001.csv"
   ```
   It lists any rows it couldn't use. Fix those and read them in again.

If there are more than about 2000 usable clips, ask the user first. They may prefer you to label a few years, or one tile in five, and leave the rest to the app's bulk labelling.

**Deciding each column.** Judge from the frames, not the file name.

| Column | How to fill it in |
| --- | --- |
| `keep` | `yes`: the user (or someone they coach, per Step 0) training, a photo of a lift, or a physique/progress photo. `no`: anything else, such as parties, kids, TV, scenery, screenshots, other athletes' videos (unless the user said otherwise), or private photos (with the note `private`). |
| `purpose` | `form` for a lift or drill (leave it empty: that's the default), `progress` for physique photos taken to compare over time, `other` for training that isn't either (for example a gym selfie). |
| `pattern` | The movement. See the table below. Leave it empty if you can't tell, and say why in `note`. |
| `variant` | The lift's name, written the same way every time: `Low-bar back squat`, `Conventional deadlift`, `Sumo deadlift`, `Bench press`, `Overhead press`, `Barbell row`, `Pull-up`. |
| `pose` | Progress photos only: `front`, `side` or `back`. |
| `note` | Short and factual, such as `two lifts in one clip`, `filmed from behind`, `unsure: rack pull or RDL`, `spotter in frame`. |

| Pattern | Covers |
| --- | --- |
| `squat` | back, front, goblet, box and safety-bar squats; leg press |
| `hinge` | deadlifts (conventional, sumo, trap bar), RDL, good morning, hip thrust, kettlebell swing, cleans and snatches |
| `lunge` | lunges, split squats, Bulgarian split squats, step-ups |
| `pushH` | bench press (any angle), push-up, dip |
| `pushV` | overhead press, push press, jerk, handstand push-up |
| `pullH` | rows of every kind |
| `pullV` | pull-up, chin-up, lat pulldown, muscle-up |
| `carry` | farmer's, suitcase and overhead carries |
| `rotation` | woodchops, landmine rotations, throws |
| `gait` | running, sprinting, walking |

You can also type a lift's name in `pattern` (for example `deadlift` or `bench press`). The tool maps it to the pattern and keeps the name as the variant.

**Check the skipped clips** for training the tool missed:

```powershell
phoenix-archive sheets --out "OUT\archive" --which skipped
```

Label any real lifts `keep=yes`. They'll be collected, but they have no tracking, so mention them in the summary. A later `--min-size 0.12 --redo` run, or importing them in the app, can track them.

### Step 5: Collect the originals

```powershell
phoenix-archive collect --out "OUT\archive" --dest "OUT\collected" --dry-run
```

Tell the user how many files this is and how much space it takes. If they agree, run it without `--dry-run`. Originals are copied byte for byte, so all their metadata comes along, and each copy is checked against its fingerprint. Each file sits in `OUT\collected\<year>\` beside its `.phoenix.json` (dates, what the tool saw, your labels, where every copy was found, and the full metadata and Takeout notes). `collected.csv` lists them all. Clips labelled `keep=no` and near-duplicates stay behind. If the user wants only what you reviewed, add `--reviewed-only`.

### Step 6: Packs for the app

```powershell
phoenix-archive pack --out "OUT\archive" --dest "OUT\packs"
phoenix-archive pack --out "OUT\archive" --dest "OUT\packs" --tracks-only
```

- The first command makes zips of up to 2 GB, with the small copies, tracks, thumbnails and labels.
- The second makes joints-and-thumbnails-only zips: tens of MB for years of clips.
- Packs never include `meta.json` or Takeout notes, and they leave out `keep=no` and near-duplicates.

In the app: **Media → Archive → Choose pack files**. Labelled patterns come in as they are; unlabelled clips get a suggestion. To share data for analysis, the app's **Dataset** tab exports without names, dates or video.

### Step 7: Summary

Write `OUT\SUMMARY.md` and give the user its highlights in chat. Work the numbers out from `OUT\archive\index.jsonl` (one JSON object per line) with a short Python script run from `.venv`. Save the script under `OUT`, not in the repository. Include:

- **Sources:** what was searched, with counts and sizes; anything unreadable (`status --errors`).
- **Found:** videos and photos found; usable; copies removed; reviewed; kept.
- **Coverage:**
  - clips by year (note any gaps);
  - by pattern and variant;
  - by camera view (side, front, angled);
  - minutes of tracked footage per pattern.
- **Quality:**
  - how dates were found;
  - clips with several people;
  - slow-motion clips;
  - anything you were unsure about.
- **Where things are:** archive, collected originals, packs, review CSVs.
- **Left to do:**
  - skipped clips you labelled keep;
  - unreviewed clips;
  - HEIC photos that couldn't be read;
  - suggestions for the dataset, such as patterns that need more side-on clips.

Finally, run `git status` in the repository and confirm it's clean (rule 2). If you changed the sleep setting, put it back. Tell the user where `SUMMARY.md` is, and that they can paste it into the cloud session to plan the next steps.

### When things go wrong

- **Errors on a few files** (damaged or unusual): list them in the summary and move on.
- **"Another run is using …"**: a run is still going, or one stopped less than two minutes ago. Check `run.log` before starting another.
- **The disk is filling up:** stop the run (Ctrl+C in its window) and ask the user. Never free up space by deleting anything outside the output root.
- **A bug in the tool:** write down the command, the error and the file it happened on. Small fixes to `tools/archive` are fine with the user's go-ahead. Test them with `pytest tools/archive/tests`, leave them uncommitted, and mention them in the summary.
- **Anything else** in `tools/archive/README.md` → Troubleshooting.
