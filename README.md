# Phoenix Atlas

A personal body-tracking and analysis app. Tap anywhere on an anatomically
detailed 3D human body (skin regions, muscles, bones, nerves, vessels or organs)
to write a dated note about how it feels, and watch the body change colour as you track workouts, symptoms,
movement, energy and general health over time. Analyse how movement patterns load your muscles and joints,
fit the body to your own measurements, import your Google health data and export PDF reports to share with
your coach.

![Atlas view](docs/atlas.jpg)

| Movement & leverage | Profile & body fitting | Layers (skeleton, nerves, vessels, organs) |
| --- | --- | --- |
| ![Movement](docs/movement.jpg) | ![Profile](docs/profile.jpg) | ![Layers](docs/layers.jpg) |

| Your training balance | Phone | Coach report (PDF) |
| --- | --- | --- |
| ![Training](docs/training.jpg) | ![Mobile](docs/mobile.jpg) | ![Report](docs/report.jpg) |

## Features

**3D atlas**
- An anatomical model of **2,705 named structures** built from [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy), whose models are based on BodyParts3D (segmented from real scan data). It has six layers:
  - **Surface**: 250 skin regions (anterior region of thigh, popliteal fossa, lumbar region…).
  - **Muscular**: 497 muscles, muscle heads and key fasciae, split into superficial and deep sets.
  - **Skeletal**: every bone, plus ligaments, cartilages, intervertebral discs and menisci.
  - **Nerves**: brain, spinal cord, cranial nerves, plexuses and peripheral nerves down to the digital branches.
  - **Vessels**: 659 arteries and veins.
  - **Organs**: heart chambers and valves, lungs by lobe, digestive and urinary organs, glands and lymph nodes.
- Every structure shows its English and Latin (Terminologia Anatomica) name. Commonly logged muscles also show what they do and which nerve supplies them.
- Search understands everyday words, so "hamstring", "IT band" or "achilles" find the right structures.
- Turn layers on and off and set each layer's opacity. Layers load on demand, and each draws in a single call, so the full model runs on a phone. A layer below 35% opacity becomes a "ghost": you can still see it, but taps go through to whatever is underneath.
- Switch muscles to **Deep** to peel away the superficial muscles and reach the ones underneath (psoas, rotator cuff, erector spinae…).
- Tap a structure to see its status, its feeling chart over time and its notes, then log a new note pinned to the exact spot you tapped.
- **Colour coding** by:
  - **Feeling**: an average of your notes in the time window, with recent notes counting more. Red means worse and blue means better.
  - **Trend**: improving or getting worse.
  - **Activity**: how much you've logged for each part.
  - **Anatomy**: natural anatomical colours.
- **Time scrubber**: drag through your history or press play to watch how your body changed. You can set the window to 7 days, 30 days, 90 days, 1 year or all time.

**Movement analysis**
- Ten fundamental **movement patterns**: squat, hinge, lunge and split squat, horizontal and vertical push, horizontal and vertical pull, loaded carry, rotation and anti-rotation, and running gait. Each has variations (high-bar, low-bar and front squat; deadlift and RDL; bench press and push-up…) and options that change its leverage (depth, ankle mobility, grip width, elbow angle, torso angle).
- **Tagged muscle groups.** 27 functional groups (quads, hamstrings, lats, rotator cuff…) are mapped onto the atlas's individual muscles. Each pattern tags the groups it uses as prime movers, synergists or stabilisers.
- **Colour-coded activation.** The 3D muscles light up by estimated effort as you scrub through the movement (or press play).
- **Interactive leverage.** A diagram poses a stick figure from your own proportions and draws, for every joint, its moment arm: the distance from the joint to the line of the load. You see the torque each joint needs (N·m), as a share of a typical maximum, and how it changes over the range. Drag across the diagram to move through the lift.
- **Joint axes on the body.** Each joint's axis of rotation is drawn on the 3D body, coloured by how hard it works. Tap an axis to see its lever and torque.
- **My training.** Every logged exercise is matched to its pattern. You get weekly sets per pattern and per muscle group (a prime mover counts a full set, a synergist half), push : pull and knee : hip balance, and how each group has felt in your notes, all coloured on the body.
- The atlas links in too: tap a muscle to see its group and the patterns that train it.

**Profile and measurements**
- Record height, weight, body fat, segment lengths (upper arm, forearm, thigh, lower leg, foot, shoulder width, arm span) and girths (neck, chest, waist, hips, and left and right arm, forearm, thigh and calf), each with how to measure it.
- **Fit the 3D body to you.** Height scales the whole body, lengths move the joints, and girths scale the soft tissue around each segment. A live preview shows the result, and you can apply it everywhere in the app. Note pins stay on the same anatomical spot when the body changes.
- Measurements are dated, so you can chart them over time. Weight also goes into your health data.
- A proportions card explains what your measurements mean: thigh-to-shin ratio and squat mechanics, arm span, BMI, waist-to-height and waist-to-hip ratios, and left/right differences.

**Notes**
- Each note is dated (and editable) and has a type (workout, symptom, movement, energy, general health, recovery), a feeling from −5 to +5, sensations (pain, tight, numb, pumped, strong…), an optional 0–10 intensity, one or more body locations, free text, tags, workout details (exercises, sets, reps, load, RPE) and custom measurements.
- **Tags link notes together.** Tap a tag to see every note with it. The Insights page draws a network of which tags appear together.
- **Explicit links and follow-ups.** "Add follow-up" starts a new note with the same locations and tags and links it back to the original. Each thread shows a progress chart, so you can see an issue improve over weeks.
- You can mark a note private to leave it out of coach reports.

**Insights**
- Average feeling compared with the previous period.
- The areas that are improving and the areas that are getting worse.
- A daily feeling chart with a 7-day average.
- A table of every body area with its average, latest value and trend.
- Workouts per week and your most common sensations.
- **How your health data relates to how you feel**: the correlation between sleep, steps, resting HR, HRV and your feeling on the same day and the next day.

**Health data**
- **Live sync from the Google Health API (v4).** This is Google's replacement for the Google Fit and Fitbit Web APIs, which are shutting down in 2026. It syncs steps, distance, calories, heart rate, resting HR, HRV, active minutes, weight, sleep and workouts.
- **File upload**, which needs no setup:
  - Google Takeout `.zip` from **Fit** or **Fitbit**. Big zips are streamed, and only the health files are read.
  - **Health Connect** export `.zip` from Android, read with SQLite in the browser.
  - Any **CSV** with a date column.

**Reports for your coach**
- Choose the period, sections, note types and tags, and write a message to your coach.
- Export a real **PDF** containing:
  - a summary and highlights
  - front and back body maps coloured by feeling (plus deep-layer maps when relevant)
  - a feeling chart
  - an areas table
  - a health data summary
  - a training log
  - your movement balance and muscle-group volume
  - your notes
- **Share** the PDF directly from your phone, or export a **CSV** of your notes, or copy a short **text summary** to paste into a message.

**Private by design**
- Everything is stored on your device in IndexedDB. Nothing is uploaded anywhere.
- Back up to a JSON file and restore it from Settings.
- The app installs on your phone and works offline.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

The 3D model ships with the repository in `public/atlas/`, so there is nothing to generate. To rebuild it from the source data, see [Anatomy data](#anatomy-data).

To explore with sample data, open **Settings → Load demo data**. It loads three months of notes and health metrics, all tagged `#demo`, and you can remove them in one tap.

To use it on your phone, deploy it (see below), open it in Safari or Chrome, and choose **Add to Home Screen** (iOS) or **Install app** (Android).

## Connecting Google health data

### Option A: live sync with the Google Health API

This is a one-time setup of about 5 minutes. You use your own Google Cloud project, so your data goes straight from Google to your browser.

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. In **APIs & Services → Library**, enable the **Google Health API**.
3. In **OAuth consent screen**, choose *External* and keep the app in *Testing*. Add yourself as a test user, then add these scopes:
   - `googlehealth.activity_and_fitness.readonly`
   - `googlehealth.health_metrics_and_measurements.readonly`
   - `googlehealth.sleep.readonly`
4. In **Credentials → Create credentials → OAuth client ID**, choose *Web application*. Add your app's address (for example `https://<you>.github.io`, or `http://localhost:5173` while developing) as an **Authorized JavaScript origin**.
5. In Phoenix Atlas, go to **Health data**, paste the client ID and press **Connect & sync**.

The access token lives only in the browser tab's session storage.

### Option B: upload an export

- **Google Takeout**: go to [takeout.google.com](https://takeout.google.com), deselect everything, select **Fit** and/or **Fitbit**, then export and drop the `.zip` into **Health data → Upload**.
- **Health Connect (Android)**: go to Settings → Health Connect → Backup/Export, export to a file, and drop the `Health Connect.zip`.
- **CSV**: use a file with a `date` column. Steps, sleep, resting HR, weight, HRV and similar columns are recognised automatically. Any other numeric columns are kept as custom metrics.

## Deploying

The build output in `dist/` is a static site that works from any path. Host it anywhere: GitHub Pages, Netlify, Vercel, Cloudflare Pages, or a folder on your own server.

To deploy with GitHub Pages:
1. Go to **Settings → Pages** and set the source to **GitHub Actions**.
2. Go to **Actions → Deploy to GitHub Pages → Run workflow**.

GitHub Pages on a private repository requires a paid GitHub plan.

If you use the Google Health sync, add the deployed origin to your OAuth client.

## Development

```bash
npm test           # unit tests (parsers, analysis, notes, reports, anatomy, body fitting, movement models)
npm run typecheck
npm run build      # type-checks and builds to dist/
```

| Path | What's there |
| --- | --- |
| `src/anatomy/` | The structure catalog (`catalog.json`, generated), reference notes, the layer file format, and the map from the first model's ids. |
| `src/model/` | Loads a layer into one merged geometry, picks structures through a BVH, the shader material that colours and hides structures, and the body fitting (`bodyShape.ts`). |
| `src/movement/` | Muscle groups, the movement pattern library, the biomechanics models, effort estimates and training analysis. |
| `src/profile/` | Profile and measurement storage. |
| `scripts/build-landmarks.ts` | Measures the reference body (joint centres, segment lengths and girths) into `src/anatomy/landmarks.json`. |
| `scripts/build-atlas.ts` | Builds `public/atlas/*.bin` and `catalog.json` from the anatomical dataset. |
| `src/components/viewer/` | The react-three-fiber body viewer, layer panel, time bar and structure panel. |
| `src/db/` | Dexie (IndexedDB) schema, notes with links and follow-ups, backup/restore, and demo data. |
| `src/analysis/` | Per-structure status, trends, correlations, and the colour mapping. |
| `src/health/` | Google Takeout, Fitbit, Health Connect and CSV parsers, plus the Google Health API client. |
| `src/report/` | Report data, offscreen body snapshots, PDF (jsPDF) and CSV export. |
| `src/pages/` | Atlas, Journal, Insights, Health data, Reports and Settings. |

### How the movement analysis works

Each pattern is a quasi-static model: the movement is treated as slow enough that inertia can be ignored. The model poses your segments at a point in the range and keeps you balanced over mid-foot where that applies. It then sums the torque from the load and from each body segment, using the masses and centres of mass in Winter's anthropometric tables. Pressing and pulling use a 3D arm with two links, so grip width and elbow angle matter. Running uses a typical ground reaction force over the stance phase.

Estimated effort is a joint's torque as a share of a typical maximum for a trained adult (for example 3.5 N·m per kg of body mass for the knee extensors). It is scaled by the group's role. These are estimates from the mechanics for learning and planning. They are not measured muscle activity (EMG) and not a clinical assessment.

### How body fitting works

The reference body is described by a simple skeleton, with joint centres measured from the model (for example a sphere fitted to each femoral head). Every vertex follows the up-to-three segments nearest to it. Arms only follow arm segments and legs only follow leg segments, so a hand resting against the thigh doesn't move with the leg. Notes keep their points on the reference body, and the points are mapped onto the fitted body for display.

### Rendering

Each layer is one merged mesh in which every vertex carries the index of its structure. A small data texture holds a colour and flags for each structure, so the viewer can recolour, highlight or hide any of them without extra draw calls. Taps are ray cast through a bounding volume hierarchy (three-mesh-bvh), and nerves and vessels get a ring of extra rays so a near miss still selects them.

## Anatomy data

The model is adapted from the Svitylo 3D Anatomy Atlas data release 1.1.0, which packages:

- **Z-Anatomy** (CC BY-SA 4.0), based on **BodyParts3D, © The Database Center for Life Science** (CC BY-SA 2.1 JP)
- kidneys from the **Human Reference Atlas** (Browne, Schlehlein; CC BY 4.0)
- the inner ear and ossicles from **OpenEar** (Sieber et al.; CC BY 4.0)

Phoenix Atlas's adapted model (`public/atlas/*.bin` and `src/anatomy/catalog.json`) is shared under **CC BY-SA 4.0**. [`public/atlas/ATTRIBUTION.md`](public/atlas/ATTRIBUTION.md) has the full attribution and the list of changes.

Some limits to know about:

- The source's cerebral cortex isn't openly licensed, so the two cerebral hemispheres are an approximate shape fitted to the skull. They are labelled "approximate" in the app.
- The upstream release hasn't had a formal anatomical review yet.
- The model is one adult male body.

To rebuild the model:

```bash
npm run anatomy:fetch   # downloads the data release from npm into .cache/anatomy (about 70 MB)
npm run model           # checks the checksums, writes public/atlas/*.bin and src/anatomy/catalog.json, then re-measures the landmarks
```

Notes saved with the first, procedural body model are migrated automatically. Their structures are mapped to the closest atlas structure, and their pins are moved onto the new surface.

## Disclaimer

Phoenix Atlas is a personal tracking tool, not a medical device. Its anatomy is detailed and uses real anatomical names, but it is meant for education and tracking. It doesn't diagnose or treat anything. Talk to a qualified professional about symptoms that concern you.
