import {
  Article,
  CalendarCheck,
  ChartBar,
  ChatsCircle,
  CheckSquare,
  Confetti,
  GameController,
  Layout,
  Storefront,
  UserCircle,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';

export type ArtKind = 'booking' | 'shop' | 'dashboard' | 'blog' | 'tracker' | 'event' | 'chat' | 'portfolio' | 'game' | 'landing';

const RULES: [ArtKind, RegExp][] = [
  ['booking', /book|appointment|schedul|reserv|class|salon|clinic|calendar/i],
  ['shop', /shop|store|e-?commerce|cart|product|sell|market|candle|merch/i],
  ['dashboard', /dashboard|admin|analytic|crm|report|metric|team|inventory|finance|budget|expense/i],
  ['tracker', /todo|to-do|task|habit|track|checklist|planner|kanban|streak|manager/i],
  ['event', /ticket|event|wedding|rsvp|party|invite|conference|meetup|ticket/i],
  ['chat', /chat|message|forum|community|social|comment/i],
  ['blog', /blog|recipe|journal|news|article|magazine|book show|story|notes|media/i],
  ['portfolio', /portfolio|resume|cv|personal|about me|photograph/i],
  ['game', /game|quiz|puzzle|trivia|play/i],
];

export function artKind(name: string): ArtKind {
  return RULES.find(([, pattern]) => pattern.test(name))?.[0] ?? 'landing';
}

const ICONS: Record<ArtKind, Icon> = {
  booking: CalendarCheck,
  shop: Storefront,
  dashboard: ChartBar,
  blog: Article,
  tracker: CheckSquare,
  event: Confetti,
  chat: ChatsCircle,
  portfolio: UserCircle,
  game: GameController,
  landing: Layout,
};

const LABELS: Record<ArtKind, string> = {
  booking: 'Booking',
  shop: 'Shop',
  dashboard: 'Dashboard',
  blog: 'Blog',
  tracker: 'Tracker',
  event: 'Event',
  chat: 'Community',
  portfolio: 'Portfolio',
  game: 'Game',
  landing: 'Website',
};

const PHOTOS: [RegExp, string][] = [
  [/wedding|rsvp/i, 'wedding'],
  [/ticket|market|event|concert|festival/i, 'market'],
  [/book|yoga|class|appointment|salon/i, 'yoga'],
  [/shop|store|candle|product|merch/i, 'candles'],
  [/dashboard|admin|sales|crm|analytic/i, 'dashboard'],
  [/habit|track|todo|task|streak/i, 'habits'],
  [/recipe|kitchen|food|cook|blog/i, 'recipes'],
  [/portfolio|photo|resume/i, 'portfolio'],
];

export function sitePhoto(name: string): string {
  const match = PHOTOS.find(([pattern]) => pattern.test(name));
  return `/sites/${match ? match[1] : 'coffee'}.jpg`;
}

export function artLabel(kind: ArtKind): string {
  return LABELS[kind];
}

const S = 'var(--line-strong)';
const F = 'color-mix(in srgb, var(--pop-3) 22%, transparent)';
const T = 'color-mix(in srgb, var(--text) 28%, transparent)';
const A = 'var(--accent)';

function Body({ kind }: { kind: ArtKind }) {
  switch (kind) {
    case 'booking':
      return (
        <>
          <rect x="14" y="26" width="58" height="7" rx="2" fill={T} />
          <rect x="14" y="37" width="40" height="3" rx="1.5" fill={F} />
          <rect x="14" y="46" width="22" height="8" rx="4" fill={A} />
          {Array.from({ length: 14 }, (_, i) => (
            <rect
              key={i}
              x={86 + (i % 7) * 9.5}
              y={28 + Math.floor(i / 7) * 11}
              width="7"
              height="8"
              rx="1.5"
              fill={i === 9 ? A : F}
              stroke={i === 9 ? 'none' : S}
              strokeWidth="0.5"
            />
          ))}
          <rect x="14" y="64" width="132" height="22" rx="3" fill={F} />
        </>
      );
    case 'shop':
      return (
        <>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={14 + i * 34} y="26" width="28" height="30" rx="3" fill={F} stroke={S} strokeWidth="0.5" />
              <rect x={14 + i * 34} y="60" width="20" height="3" rx="1.5" fill={T} />
              <rect x={14 + i * 34} y="66" width="12" height="3" rx="1.5" fill={i === 1 ? A : F} />
              <rect x={14 + i * 34} y="74" width="28" height="8" rx="4" fill={i === 1 ? A : 'none'} stroke={i === 1 ? 'none' : S} strokeWidth="0.6" />
            </g>
          ))}
        </>
      );
    case 'dashboard':
      return (
        <>
          <rect x="6" y="18" width="28" height="76" fill={F} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="11" y={28 + i * 9} width="18" height="3" rx="1.5" fill={i === 0 ? A : T} />
          ))}
          {[0, 1, 2].map((i) => (
            <rect key={i} x={42 + i * 36} y="26" width="30" height="16" rx="3" fill={F} stroke={i === 0 ? A : S} strokeWidth="0.6" />
          ))}
          <rect x="42" y="48" width="102" height="38" rx="3" fill="none" stroke={S} strokeWidth="0.6" />
          {[12, 20, 15, 26, 18, 30, 22].map((h, i) => (
            <rect key={i} x={50 + i * 13} y={82 - h} width="7" height={h} rx="1.5" fill={i === 5 ? A : T} />
          ))}
        </>
      );
    case 'tracker':
      return (
        <>
          <rect x="14" y="26" width="50" height="6" rx="2" fill={T} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x="14" y={40 + i * 12} width="132" height="9" rx="2" fill={F} />
              <rect x="18" y={42 + i * 12} width="5" height="5" rx="1" fill={i < 2 ? A : 'none'} stroke={i < 2 ? 'none' : S} strokeWidth="0.7" />
              <rect x="28" y={43.5 + i * 12} width={[60, 44, 70, 52][i]} height="2.5" rx="1.25" fill={T} />
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <circle key={i} cx={104 + i * 6} cy="29" r="2" fill={i < 5 ? A : F} />
          ))}
        </>
      );
    case 'event':
      return (
        <>
          <rect x="30" y="24" width="100" height="62" rx="4" fill={F} stroke={S} strokeWidth="0.5" />
          <rect x="52" y="33" width="56" height="7" rx="2" fill={T} />
          <rect x="62" y="44" width="36" height="3" rx="1.5" fill={F} />
          <rect x="44" y="54" width="72" height="7" rx="2" fill="none" stroke={S} strokeWidth="0.6" />
          <rect x="62" y="68" width="36" height="9" rx="4.5" fill={A} />
          {[[20, 30], [140, 36], [24, 74], [136, 78]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2" fill={i % 2 ? A : T} />
          ))}
        </>
      );
    case 'chat':
      return (
        <>
          <rect x="14" y="26" width="70" height="12" rx="6" fill={F} />
          <rect x="66" y="42" width="80" height="12" rx="6" fill={A} opacity="0.85" />
          <rect x="14" y="58" width="56" height="12" rx="6" fill={F} />
          <rect x="14" y="76" width="132" height="10" rx="5" fill="none" stroke={S} strokeWidth="0.6" />
        </>
      );
    case 'blog':
      return (
        <>
          <rect x="14" y="24" width="132" height="30" rx="3" fill={F} />
          <circle cx="40" cy="39" r="7" fill={A} opacity="0.7" />
          <rect x="14" y="60" width="80" height="6" rx="2" fill={T} />
          <rect x="14" y="70" width="110" height="2.5" rx="1.25" fill={F} />
          <rect x="14" y="76" width="96" height="2.5" rx="1.25" fill={F} />
          <rect x="14" y="82" width="70" height="2.5" rx="1.25" fill={F} />
        </>
      );
    case 'portfolio':
      return (
        <>
          <circle cx="34" cy="42" r="14" fill={F} stroke={A} strokeWidth="1" />
          <rect x="56" y="32" width="70" height="7" rx="2" fill={T} />
          <rect x="56" y="44" width="50" height="3" rx="1.5" fill={F} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={14 + i * 45} y="64" width="40" height="24" rx="3" fill={i === 1 ? A : F} opacity={i === 1 ? 0.75 : 1} />
          ))}
        </>
      );
    case 'game':
      return (
        <>
          {Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x={44 + (i % 4) * 18}
              y={26 + Math.floor(i / 4) * 20}
              width="15"
              height="17"
              rx="3"
              fill={[2, 7].includes(i) ? A : F}
              stroke={S}
              strokeWidth="0.5"
            />
          ))}
        </>
      );
    default:
      return (
        <>
          <rect x="14" y="28" width="70" height="8" rx="2" fill={T} />
          <rect x="14" y="40" width="54" height="8" rx="2" fill={T} />
          <rect x="14" y="53" width="60" height="3" rx="1.5" fill={F} />
          <rect x="14" y="62" width="24" height="8" rx="4" fill={A} />
          <rect x="94" y="26" width="52" height="44" rx="4" fill={F} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={14 + i * 45} y="78" width="40" height="10" rx="2" fill={F} />
          ))}
        </>
      );
  }
}

export default function ProjectArt({ name, className = '' }: { name: string; className?: string }) {
  const kind = artKind(name);
  const KindIcon = ICONS[kind];

  return (
    <div className={`relative overflow-hidden bg-[var(--panel)] ${className}`}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <rect x="6" y="6" width="148" height="94" rx="5" fill="var(--bg)" stroke={S} strokeWidth="0.6" />
        <rect x="14" y="11" width="18" height="3" rx="1.5" fill={T} />
        <rect x="112" y="11" width="10" height="3" rx="1.5" fill={F} />
        <rect x="126" y="11" width="10" height="3" rx="1.5" fill={F} />
        <rect x="140" y="11" width="8" height="3" rx="1.5" fill={A} />
        <Body kind={kind} />
      </svg>
      <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-[6px] border-[1.5px] border-[var(--edge)] bg-white py-1 pl-1.5 pr-2.5 text-[11px] font-medium text-[var(--muted)] backdrop-blur">
        <KindIcon size={13} weight="duotone" className="text-[var(--accent-text)]" />
        {artLabel(kind)}
      </span>
    </div>
  );
}
