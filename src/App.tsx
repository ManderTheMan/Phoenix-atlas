import { lazy, Suspense, useEffect, useState } from 'react';
import { Toast } from './components/common';
import Icon from './components/Icon';
import MediaModals from './components/media/MediaModals';
import NoteModals from './components/notes/NoteModals';
import { resnapLegacyPoints } from './db/resnap';
import { useMediaUI } from './media/mediaUI';
import { useProfile } from './profile/profile';
import AtlasPage from './pages/AtlasPage';
import JournalPage from './pages/JournalPage';
import SettingsPage from './pages/SettingsPage';
import { capturePairLink } from './coach/link';
import { useUI, type Route } from './state/ui';

const InsightsPage = lazy(() => import('./pages/InsightsPage'));
const HealthPage = lazy(() => import('./pages/HealthPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const MovementPage = lazy(() => import('./pages/MovementPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
const CoachPage = lazy(() => import('./pages/CoachPage'));

/** `phone: false` keeps an item out of the phone's bottom bar (it moves to the header). */
const NAV: { id: Route; label: string; icon: string; phone?: false }[] = [
  { id: 'atlas', label: 'Atlas', icon: 'body' },
  { id: 'movement', label: 'Movement', icon: 'movement' },
  { id: 'media', label: 'Media', icon: 'camera' },
  { id: 'journal', label: 'Journal', icon: 'book' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'health', label: 'Health data', icon: 'heart' },
  { id: 'reports', label: 'Reports', icon: 'file' },
  { id: 'settings', label: 'Settings', icon: 'gear', phone: false },
];

const ROUTES = new Set<Route>([...NAV.map((n) => n.id), 'profile', 'coach']);

export default function App() {
  const route = useUI((s) => s.route);
  const setRoute = useUI((s) => s.setRoute);

  // keep the URL hash and the route in sync (back button, shareable deep links)
  useEffect(() => {
    const fromHash = () => {
      if (capturePairLink()) return setRoute('coach');
      const r = location.hash.replace(/^#\/?/, '') as Route;
      if (ROUTES.has(r)) setRoute(r);
    };
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [setRoute]);
  useEffect(() => {
    if (location.hash.replace(/^#\/?/, '') !== route) history.replaceState(null, '', `#/${route}`);
  }, [route]);
  // notes from before the anatomical atlas keep their places on the new body
  useEffect(() => {
    resnapLegacyPoints().catch((e) => console.warn('Could not move old note pins onto the atlas', e));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <button className="brand" onClick={() => setRoute('atlas')} aria-label="Phoenix Atlas home">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <span>
            Phoenix <em>Atlas</em>
          </span>
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.id} className={route === n.id ? 'active' : ''} onClick={() => setRoute(n.id)} aria-current={route === n.id ? 'page' : undefined}>
              <Icon name={n.icon} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="header-spacer" />
        <CaptureButton />
        <button className={`header-icon phone-only ${route === 'settings' ? 'active' : ''}`} onClick={() => setRoute('settings')} aria-label="Settings and data" title="Settings and data">
          <Icon name="gear" />
        </button>
        <ProfileButton active={route === 'profile'} onClick={() => setRoute('profile')} />
      </header>
      <main className="main">
        <Suspense
          fallback={
            <div className="viewer-loading">
              <div className="spinner" />
            </div>
          }
        >
          {route === 'atlas' && <AtlasPage />}
          {route === 'journal' && <JournalPage />}
          {route === 'insights' && <InsightsPage />}
          {route === 'health' && <HealthPage />}
          {route === 'reports' && <ReportsPage />}
          {route === 'settings' && <SettingsPage />}
          {route === 'movement' && <MovementPage />}
          {route === 'profile' && <ProfilePage />}
          {route === 'media' && <MediaPage />}
          {route === 'coach' && <CoachPage />}
        </Suspense>
      </main>
      <nav className="bottom-nav" aria-label="Main">
        {NAV.filter((n) => n.phone !== false).map((n) => (
          <button key={n.id} className={route === n.id ? 'active' : ''} onClick={() => setRoute(n.id)}>
            <Icon name={n.icon} />
            {n.label.split(' ')[0]}
          </button>
        ))}
      </nav>
      <NoteModals />
      <MediaModals />
      <Toast />
    </div>
  );
}

/** Quick capture from anywhere: a photo or a clip, with what it is for chosen after. */
function CaptureButton() {
  const [open, setOpen] = useState(false);
  const route = useUI((s) => s.route);
  const openCamera = useMediaUI((s) => s.openCamera);
  const pick = (mode: 'photo' | 'video', purpose: 'progress' | 'form' | 'other', extra: { sequence?: boolean; upload?: boolean } = {}) => {
    setOpen(false);
    openCamera({ mode, purpose, ...(purpose === 'progress' ? { pose: 'front' } : {}), ...extra });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !(e.target as HTMLElement).closest?.('.capture') && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="capture">
      <button className={`header-icon ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Take a photo or video" aria-expanded={open} title="Take a photo or video">
        <Icon name="camera" />
      </button>
      {open && (
        <div className="capture-menu" role="menu">
          <button role="menuitem" onClick={() => pick('photo', 'progress', { sequence: true })}>
            <Icon name="user" /> Progress photos <span className="tiny muted">front, side, back</span>
          </button>
          <button role="menuitem" onClick={() => pick('video', 'form')}>
            <Icon name="video" /> Form video <span className="tiny muted">film a set</span>
          </button>
          <button role="menuitem" onClick={() => pick('photo', 'other')}>
            <Icon name="camera" /> Other photo <span className="tiny muted">a bruise, posture…</span>
          </button>
          <button role="menuitem" onClick={() => pick('photo', route === 'movement' ? 'form' : 'progress', { upload: true })}>
            <Icon name="upload" /> Import from library
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const profile = useProfile();
  const initials = (profile.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <button className={`profile-btn ${active ? 'active' : ''}`} onClick={onClick} aria-label="Profile and measurements" title="Profile and measurements">
      {initials ? <span className="avatar">{initials}</span> : <Icon name="user" />}
      <span className="profile-btn-label">Profile</span>
    </button>
  );
}
