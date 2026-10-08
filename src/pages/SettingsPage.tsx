import { useRef, useState } from 'react';
import { STRUCTURES } from '../anatomy/catalog';
import { ConfirmButton } from '../components/common';
import Icon from '../components/Icon';
import { clearAll, downloadBlob, makeBackup, parseBackup, restoreBackup } from '../db/backup';
import { clearDemoData, seedDemoData } from '../db/seed';
import { useMetrics, useNotes } from '../hooks/useData';
import { dayKey } from '../lib/dates';
import { useUI } from '../state/ui';

export default function SettingsPage() {
  const ui = useUI();
  const notes = useNotes();
  const metrics = useMetrics();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hasDemo = notes.some((n) => n.source === 'demo') || metrics.some((m) => m.source === 'demo');

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    try {
      const msg = await fn();
      if (msg) ui.showToast(msg);
    } catch (e) {
      ui.showToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <div>
            <h1>Settings & data</h1>
            <p>Everything is stored privately on this device. Back it up regularly.</p>
          </div>
        </div>

        <div className="card col">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h3>Your data</h3>
            <span className="muted small">
              {notes.length} notes · {metrics.length} health data points
            </span>
          </div>
          <p className="dim small">
            Phoenix Atlas keeps your notes in this browser’s storage (IndexedDB). Nothing is uploaded anywhere. Clearing site data or
            switching devices loses it — download a backup and restore it on another device.
          </p>
          <div className="row wrap">
            <button
              className="btn primary"
              disabled={!!busy}
              onClick={() =>
                run('backup', async () => {
                  const b = await makeBackup();
                  downloadBlob(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), `phoenix-atlas-backup-${dayKey(Date.now())}.json`);
                  return 'Backup downloaded';
                })
              }
            >
              <Icon name="download" /> Download backup
            </button>
            <button className="btn" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> Restore from backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                run('restore', async () => {
                  const b = parseBackup(await f.text());
                  const r = await restoreBackup(b, 'merge');
                  return `Restored ${r.notes} notes and ${r.metrics} data points`;
                });
              }}
            />
          </div>
        </div>

        <div className="card col">
          <h3>Demo data</h3>
          <p className="dim small">
            Load three months of example notes (a recovering knee, a lower-back flare-up, a shoulder pinch, workouts, energy and sleep) and
            matching health metrics to explore the atlas, insights and reports. Demo items are tagged <code>#demo</code> and can be removed
            in one tap.
          </p>
          <div className="row wrap">
            <button
              className="btn"
              disabled={!!busy || hasDemo}
              onClick={() =>
                run('seed', async () => {
                  const n = await seedDemoData();
                  return `Loaded ${n} demo notes`;
                })
              }
            >
              <Icon name="sparkle" /> {busy === 'seed' ? 'Loading…' : 'Load demo data'}
            </button>
            <button className="btn" disabled={!!busy || !hasDemo} onClick={() => run('unseed', async () => (await clearDemoData(), 'Demo data removed'))}>
              <Icon name="trash" /> Remove demo data
            </button>
          </div>
        </div>

        <div className="card col">
          <h3>Anatomy data &amp; licences</h3>
          <p className="dim small">
            The 3D body is built from{' '}
            <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noreferrer">
              Z-Anatomy
            </a>
            , whose models are based on <em>BodyParts3D, © The Database Center for Life Science</em> (segmented from real scan data). The
            kidneys come from the Human Reference Atlas (Browne, Schlehlein) and the inner ear and ossicles from OpenEar (Sieber et al.). The
            data was prepared by the Svitylo 3D Anatomy Atlas project; English and Latin names follow Terminologia Anatomica 2.
          </p>
          <p className="dim small">
            Licensed under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
              CC BY-SA 4.0
            </a>{' '}
            (kidneys and ear: CC BY 4.0). Phoenix Atlas’s adapted model (selected structures, simplified and merged into layers) is shared under
            the same licence.{' '}
            <a href={`${import.meta.env.BASE_URL}atlas/ATTRIBUTION.md`} target="_blank" rel="noreferrer">
              Full attribution and changes
            </a>
            .
          </p>
          <p className="dim small">
            {STRUCTURES.length.toLocaleString()} structures. The cerebral cortex in the source isn’t openly licensed, so the cerebral hemispheres
            are an approximate shape fitted to the skull. The upstream data release hasn’t had a formal anatomical review yet. This is an
            anatomically detailed model for education and personal tracking, not a medical device.
          </p>
        </div>

        <div className="card col">
          <h3>Install on your phone</h3>
          <p className="dim small">
            Phoenix Atlas works offline as an installable app. On iPhone: open it in Safari → Share → <em>Add to Home Screen</em>. On
            Android/Chrome: menu → <em>Install app</em>. Your data stays on the device you install it on.
          </p>
        </div>

        <div className="card col" style={{ borderColor: '#4a2a30' }}>
          <h3>Danger zone</h3>
          <p className="dim small">Permanently delete every note, health data point and setting on this device.</p>
          <div>
            <ConfirmButton onConfirm={() => run('clear', async () => (await clearAll(), 'All data deleted'))}>
              <Icon name="trash" /> Delete all data
            </ConfirmButton>
          </div>
        </div>

        <p className="tiny muted">
          Phoenix Atlas is a personal tracking tool, not a medical device. It does not diagnose or treat any condition — talk to a qualified
          professional about symptoms that worry you.
        </p>
      </div>
    </div>
  );
}
