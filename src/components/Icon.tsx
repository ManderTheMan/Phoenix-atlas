// Minimal stroke icon set (24px grid).
const PATHS: Record<string, string> = {
  body: 'M12 2.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM6 8.5l6 1.2 6-1.2M12 9.7v5.3M12 15l-3 6.5M12 15l3 6.5M8.2 9.1 6.6 15M15.8 9.1l1.6 5.9',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6M9 10.5h6',
  chart: 'M4 20h16M6.5 16.5l4-5 3.5 3 4.5-7M17 7.5h1.5V9',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10zM6.5 12.5h3l1.5-2.5 2 4 1.5-2h3',
  file: 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3zM14 3v4.5h4.5M9 13h6M9 16.5h4',
  gear: 'M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M9.5 7V4.5h5V7',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0L3.5 12.2zM8 8h.01',
  share: 'M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13',
  download: 'M12 3.5v12M7.5 11 12 15.5 16.5 11M5 19.5h14',
  upload: 'M12 15.5v-12M7.5 8 12 3.5 16.5 8M5 19.5h14',
  calendar: 'M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  layers: 'M12 3.5 3 8.5l9 5 9-5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  repeat: 'M4 12a7 7 0 0 1 12-4.9L18.5 9.5M18.5 4.5v5h-5M20 12a7 7 0 0 1-12 4.9L5.5 14.5M5.5 19.5v-5h5',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11zM12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  eyeOff: 'M4 4l16 16M10 6a8.6 8.6 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.6A15.5 15.5 0 0 0 2.5 12S6 18.5 12 18.5a8.8 8.8 0 0 0 4.4-1.2M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6',
  lock: 'M6.5 10.5h11v9.5h-11zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  cloud: 'M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 17.5 18.5H7z',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  dumbbell: 'M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11',
  menu: 'M4 7h16M4 12h16M4 17h16',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  info: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11v5.5M12 7.5h.01',
};

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, className }: { name: IconName | string; size?: number; className?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  const filled = name === 'play';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
