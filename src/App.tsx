import { lazy, Suspense, useEffect } from 'react';
import { Toast } from './components/common';
import Icon from './components/Icon';
import NoteModals from './components/notes/NoteModals';
import { resnapLegacyPoints } from './db/resnap';
import AtlasPage from './pages/AtlasPage';
import JournalPage from './pages/JournalPage';
import SettingsPage from './pages/SettingsPage';
import { useUI, type Route } from './state/ui';

const InsightsPage = lazy(() => import('./pages/InsightsPage'));
const HealthPage = lazy(() => import('./pages/HealthPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

const NAV: { id: Route; label: string; icon: string }[] = [
  { id: 'atlas', label: 'Atlas', icon: 'body' },
  { id: 'journal', label: 'Journal', icon: 'book' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'health', label: 'Health data', icon: 'heart' },
  { id: 'reports', label: 'Reports', icon: 'file' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

const ROUTES = new Set<Route>(NAV.map((n) => n.id));

export default function App() {
  const route = useUI((s) => s.route);
  const setRoute = useUI((s) => s.setRoute);

  // keep the URL hash and the route in sync (back button, shareable deep links)
  useEffect(() => {
    const fromHash = () => {
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
        </Suspense>
      </main>
      <nav className="bottom-nav" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className={route === n.id ? 'active' : ''} onClick={() => setRoute(n.id)}>
            <Icon name={n.icon} />
            {n.label.split(' ')[0]}
          </button>
        ))}
      </nav>
      <NoteModals />
      <Toast />
    </div>
  );
}
