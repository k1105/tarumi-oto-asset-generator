// 道具の絵 (16px の線画)
const P: Record<string, string> = {
  text: 'M3 4V3h10v1M8 3v10M6 13h4',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5M10.5 6.2a.7.7 0 1 0 0-.01',
  rect: 'M2.5 4.5h11v7h-11z',
  video: 'M2.5 3.5h11v9h-11zM6.8 6v4l3.4-2z',
  undo: 'M6 4 3 7l3 3M3 7h6.5a3 3 0 0 1 0 6H7',
  redo: 'M10 4l3 3-3 3M13 7H6.5a3 3 0 0 0 0 6H9',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6',
  eyeOff: 'M2 2l12 12M6.3 4A6.6 6.6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2 2.5M9.9 11.9A6 6 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11 11 0 0 1 2.7-3.1',
  lock: 'M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  unlock: 'M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 0 1 4.8-1',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5 3.5v9M11 3.5v9',
  down: 'M4 6l4 4 4-4',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  left: 'M3 4h10M3 8h6M3 12h8',
  center: 'M3 4h10M5 8h6M4 12h8',
  right: 'M3 4h10M7 8h6M5 12h8',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  bg: 'M2.5 2.5h11v11h-11zM2.5 9l4-4M2.5 13.5l11-11M7 13.5l6.5-6.5',
  mute: 'M2.5 6.5h2l3-2.5v8l-3-2.5h-2zM10 6l3.5 4M13.5 6 10 10',
  sound: 'M2.5 6.5h2l3-2.5v8l-3-2.5h-2zM10 6a3 3 0 0 1 0 4M11.8 4.3a5.5 5.5 0 0 1 0 7.4',
};

export default function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
