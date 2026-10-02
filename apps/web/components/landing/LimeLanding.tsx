'use client';

import { SignInButton, UserButton } from '@clerk/nextjs';
import {
  ArrowRight,
  ArrowUpRight,
  CaretDown,
  Check,
  CheckCircle,
  DotsThree,
  GithubLogo,
  Lightning,
  List,
  X,
} from '@phosphor-icons/react';
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { sitePhoto } from '@/components/ProjectArt';
import { Bubble, EASE, LimeButton, Logo, Polaroid } from '@/components/lime';
import ThemeToggle from '@/components/ThemeToggle';
import LiveDemo from '@/components/landing/LiveDemo';
import Simple from '@/components/landing/Simple';


type Props = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  prompt: string;
  setPrompt: (value: string) => void;
  start: () => void;
  busy: boolean;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  focusPrompt: (text?: string) => void;
};

function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const SECTIONS = [
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#why', label: 'Why us' },
  { href: '#faqs', label: 'FAQs' },
];

function Nav({ isLoaded, isSignedIn, focusPrompt }: Pick<Props, 'isLoaded' | 'isSignedIn' | 'focusPrompt'>) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById('lime-top');
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  const pill = 'rounded-[10px] bg-[var(--ink)] text-[12.5px] font-bold uppercase text-white';

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-sticky)]">
      <div className="mx-auto flex h-[72px] w-full max-w-[1312px] items-center justify-between gap-3 px-4 md:h-[84px] md:px-8">
        <span className="pointer-events-auto">
          <Logo compact={scrolled} />
        </span>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <ThemeToggle className="!h-[42px] !w-[42px]" />
          <AnimatePresence>
            {!scrolled && (
              <motion.nav
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3, ease: EASE }}
                className={`hidden items-center gap-7 px-6 py-3 lg:flex ${pill}`}
                aria-label="Sections"
              >
                {SECTIONS.map((item) => (
                  <a key={item.href} href={item.href} className="transition-colors hover:text-[var(--lime)]">
                    {item.label}
                  </a>
                ))}
              </motion.nav>
            )}
          </AnimatePresence>
          {isLoaded && !isSignedIn && (
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className={`hidden h-[42px] px-4 transition-colors hover:text-[var(--lime)] sm:block ${pill}`}>Sign in</button>
            </SignInButton>
          )}
          {isLoaded && isSignedIn ? (
            <>
              <Link href="/dashboard" className={`hidden h-[42px] items-center gap-3 pl-4 pr-1.5 sm:flex ${pill}`}>
                Dashboard
                <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--lime)] text-[var(--ink)]">
                  <ArrowRight size={14} weight="bold" />
                </span>
              </Link>
              <span className="ml-1 flex h-10 items-center">
                <UserButton />
              </span>
            </>
          ) : (
            <button onClick={() => focusPrompt()} className={`hidden h-[42px] items-center gap-3 pl-4 pr-1.5 sm:flex ${pill}`}>
              Start building
              <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--lime)] text-[var(--ink)]">
                <ArrowRight size={14} weight="bold" />
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className={`flex h-[42px] w-[42px] items-center justify-center lg:hidden ${pill}`}
          >
            {menuOpen ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="pointer-events-auto mx-4 rounded-[14px] border-2 border-[var(--edge)] bg-[var(--ink)] p-3 text-white shadow-[var(--hard)] md:mx-8 lg:hidden"
          >
            <nav aria-label="Sections" className="flex flex-col">
              {SECTIONS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-[48px] items-center rounded-[8px] px-3 text-[16px] font-bold transition-colors hover:bg-white/10 hover:text-[var(--lime)]"
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-2 grid gap-2 border-t border-white/15 pt-3 sm:hidden">
              {isLoaded && isSignedIn ? (
                <Link
                  href="/dashboard"
                  className="flex min-h-[48px] items-center justify-center rounded-[8px] bg-[var(--lime)] text-[13px] font-bold uppercase text-[var(--ink)]"
                >
                  Go to dashboard
                </Link>
              ) : (
                <>
                  {isLoaded && (
                    <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                      <button
                        onClick={() => setMenuOpen(false)}
                        className="min-h-[48px] rounded-[8px] border-2 border-white/30 text-[13px] font-bold uppercase transition-colors hover:border-[var(--lime)] hover:text-[var(--lime)]"
                      >
                        Sign in
                      </button>
                    </SignInButton>
                  )}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      focusPrompt();
                    }}
                    className="min-h-[48px] rounded-[8px] bg-[var(--lime)] text-[13px] font-bold uppercase text-[var(--ink)]"
                  >
                    Start building
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

const POLAROIDS = [
  { name: 'Yoga Class Booking', x: 'calc(50% - 476px)', y: '11%', r: 4, depth: 18, w: 'w-[210px]', delay: 0 },
  { name: 'Candle Shop', x: 'max(2%, calc(50% - 680px))', y: '40%', r: -9, depth: 28, w: 'w-[220px]', delay: 0.08 },
  { name: 'Wedding RSVP', x: 'calc(50% + 266px)', y: '11%', r: -4, depth: 18, w: 'w-[210px]', delay: 0.16 },
  { name: 'Habit Tracker', x: 'min(calc(98% - 220px), calc(50% + 460px))', y: '40%', r: 9, depth: 28, w: 'w-[220px]', delay: 0.24 },
];

function FloatingPolaroid({ item, mx, my }: { item: (typeof POLAROIDS)[number]; mx: ReturnType<typeof useSpring>; my: ReturnType<typeof useSpring> }) {
  const x = useTransform(mx, (v) => v * item.depth);
  const y = useTransform(my, (v) => v * item.depth);
  return (
    <motion.div className="absolute hidden min-[1200px]:block" style={{ left: item.x, top: item.y, x, y }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.5, rotate: item.r - 25 }}
        animate={{ opacity: 1, scale: 1, rotate: item.r }}
        transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.25 + item.delay }}
      >
        <div className="lime-float" style={{ animationDelay: `${item.delay * 6}s` }}>
          <Polaroid name={item.name} className={item.w} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function Hero(props: Props) {
  const reduced = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18 });

  return (
    <section
      className="relative overflow-hidden pb-20 pt-[120px] md:pt-[150px] min-[1200px]:flex min-[1200px]:h-[100dvh] min-[1200px]:min-h-[680px] min-[1200px]:flex-col min-[1200px]:justify-center min-[1200px]:pb-10 min-[1200px]:pt-[88px]"
      onPointerMove={(event) => {
        if (reduced) return;
        const rect = event.currentTarget.getBoundingClientRect();
        rawX.set((event.clientX - rect.left) / rect.width - 0.5);
        rawY.set((event.clientY - rect.top) / rect.height - 0.5);
      }}
    >
      <div id="lime-top" className="absolute top-0 h-24 w-px" />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-12%] aspect-square w-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-[var(--soft)] [mask-image:linear-gradient(to_bottom,black_55%,transparent_88%)]"
      />
      <motion.div
        aria-hidden="true"
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 120, ease: 'linear', repeat: Infinity }}
        className="absolute left-1/2 top-[-4%] hidden aspect-square w-[min(960px,130vw)] -translate-x-1/2 rounded-full border-2 border-dashed border-[var(--dash)] [mask-image:linear-gradient(to_bottom,black_55%,transparent_90%)] md:block"
      />
      {POLAROIDS.map((item) => (
        <FloatingPolaroid key={item.name} item={item} mx={mx} my={my} />
      ))}
      <div className="relative mx-auto flex w-full max-w-[860px] flex-col items-center px-5 text-center">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--ink)] px-3 py-1.5 text-[14px] font-medium text-white"
        >
          <Lightning size={15} weight="fill" className="text-[var(--lime)]" />
          Real code, live preview
        </motion.span>
        <h1 className="mt-8 text-[clamp(44px,5.8vw,80px)] font-bold leading-[1.02] tracking-[-0.035em]">
          Your App,
          <br />
          Built While You Watch.
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
          className="mt-7 max-w-[44ch] text-[18px] font-medium leading-[1.45] text-[var(--muted)]"
        >
          Describe it in plain words. Inkling writes the code and shows you the live app. No coding, no setup.
        </motion.p>

        <motion.div
          id="start"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.28, ease: EASE }}
          className="mt-10 w-full max-w-[640px] scroll-mt-32 text-left"
        >
          <label htmlFor="lime-prompt" className="sr-only">
            Describe the app you want
          </label>
          <div className="rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] p-2 shadow-[6px_6px_0_var(--edge)] transition-shadow focus-within:shadow-[6px_6px_0_var(--edge),0_0_0_6px_var(--accent-ring)]">
            <textarea
              id="lime-prompt"
              ref={props.inputRef}
              value={props.prompt}
              onChange={(e) => props.setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  props.start();
                }
              }}
              rows={2}
              placeholder="What do you want to make? Try: a booking page for my yoga classes"
              className="block w-full resize-none bg-transparent px-3 pt-2 text-[16px] font-medium leading-relaxed outline-none placeholder:text-[var(--faint)]"
            />
            <div className="flex items-center justify-end gap-3 sm:justify-between sm:pl-3">
              <span className="hidden text-[12.5px] font-medium text-[var(--muted)] sm:inline">Press Enter to start</span>
              <LimeButton onClick={props.start} disabled={props.busy}>
                {props.busy ? 'Starting' : 'Start building'}
              </LimeButton>
            </div>
          </div>
          {props.error && (
            <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--error)]">
              {props.error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {['Booking page for my yoga classes', 'Online shop for my candles', 'Habit tracker with streaks'].map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  props.setPrompt(tag);
                  props.inputRef.current?.focus();
                }}
                className="min-h-[40px] rounded-[8px] border-2 border-[var(--edge)] bg-[var(--panel)] px-3 text-[13px] font-bold transition-colors hover:bg-[var(--lime)] hover:text-[var(--ink)] sm:min-h-[34px]"
              >
                {tag}
              </button>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="relative mt-14 flex justify-center gap-4 px-5 sm:gap-8 min-[1200px]:hidden">
        <Polaroid name="Yoga Class Booking" className="w-[44%] max-w-[240px] -rotate-6" />
        <Polaroid name="Candle Shop" className="mt-6 w-[44%] max-w-[240px] rotate-6" />
      </div>
    </section>
  );
}

const CHORES = [
  'Set up a Next.js project',
  'Install the right packages',
  'Design the layouts',
  'Fix TypeScript errors',
  'Connect a database',
  'Hide your API keys safely',
  'Make it work on phones',
  'Debug the build',
  'Fix spacing and alignment',
  'Set up hosting',
  'Push the code to GitHub',
  'Figure out why it broke again',
];

const ROW = 60;

function Checklist() {
  const reduced = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const offset = useRef(0);
  const [frontier, setFrontier] = useState(Math.floor(CHORES.length / 2));
  const total = CHORES.length * ROW;

  useAnimationFrame((_, delta) => {
    if (reduced) return;
    const band = (boxRef.current?.clientHeight ?? 400) * 0.55;
    offset.current = (offset.current + delta * 0.028) % total;
    y.set(-offset.current);
    const next = Math.floor((offset.current + band) / ROW);
    setFrontier((prev) => (prev === next ? prev : next));
  });

  const done = ((frontier % CHORES.length) + CHORES.length) % CHORES.length || CHORES.length;

  return (
    <section className="px-4 pt-32 md:px-8 md:pt-44">
      <div className="relative mx-auto grid max-w-[1312px] overflow-hidden rounded-[20px] bg-[var(--ink)] text-white md:h-[480px] md:grid-cols-2">
        <div
          ref={boxRef}
          className="relative h-[360px] overflow-hidden px-6 md:h-auto md:px-16 [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]"
        >
          <motion.div style={{ y }}>
            {[...CHORES, ...CHORES].map((chore, index) => {
              const isDone = index < frontier;
              return (
                <div
                  key={index}
                  style={{ height: ROW - 8 }}
                  className={`mb-2 flex items-center gap-3 rounded-[6px] border px-4 text-[14.5px] transition-colors duration-300 ${
                    isDone ? 'border-[var(--lime)]/30 bg-[#262a1c]' : 'border-white/10 bg-[var(--ink-2)]'
                  }`}
                >
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors duration-300 ${
                      isDone ? 'border-[var(--lime)] bg-[var(--lime)] text-[var(--ink)]' : 'border-white/45'
                    }`}
                  >
                    {isDone && <Check size={11} weight="bold" />}
                  </span>
                  <span className={`flex-1 transition-colors duration-300 ${isDone ? 'text-white/65 line-through decoration-[var(--lime)] decoration-2' : 'text-white/90'}`}>
                    {chore}
                  </span>
                  {isDone ? (
                    <span className="rounded-[4px] bg-[var(--lime)] px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-[var(--ink)]">Done</span>
                  ) : (
                    <DotsThree size={18} weight="bold" className="text-white/50" />
                  )}
                </div>
              );
            })}
          </motion.div>
          <Bubble className="left-[30%] top-[14%] -rotate-3 max-md:!hidden">I just wanted a booking page</Bubble>
        </div>
        <div className="relative flex flex-col justify-center px-6 py-14 md:px-12">
          <h2 className="max-w-[15ch] text-[clamp(32px,3.4vw,44px)] font-bold leading-[1.12] tracking-[-0.02em]">
            Building an App Shouldn&rsquo;t Feel Like a Never-Ending To-Do List
          </h2>
          <p className="mt-8 flex max-w-[40ch] items-start gap-2.5 text-[16px] font-medium leading-[1.45] text-white/80">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--lime)] text-[var(--ink)]">
              <Check size={12} weight="bold" />
            </span>
            So Inkling ticks every one of them off for you. Watch the list.
          </p>
          <p className="mt-6 text-[13px] font-bold uppercase tracking-[0.02em] text-[var(--lime)] tabular-nums">{done} of {CHORES.length} done for you</p>
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section id="demo" className="px-3 pt-8 md:px-6 md:pt-12">
      <div className="relative mx-auto max-w-[1360px] overflow-hidden rounded-[28px] bg-[var(--ink)] px-4 pb-16 pt-24 text-white md:px-10 md:pb-20 md:pt-32">
        <Reveal className="mx-auto max-w-[640px] text-center">
          <h2 className="text-[clamp(34px,4.4vw,58px)] font-bold leading-[1.06] tracking-[-0.03em]">
            One Sentence Is All It Takes.
          </h2>
          <p className="mx-auto mt-6 max-w-[44ch] text-[17px] font-medium leading-[1.5] text-white/70">
            Watch one real build, from the first message to the finished site.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="relative mx-auto mt-16 max-w-[1180px] text-[var(--text)] md:mt-20">
          <LiveDemo />
        </Reveal>
      </div>
    </section>
  );
}

const INCLUDED = [
  'Unlimited projects',
  'Live preview while it builds',
  'Real Next.js code',
  'Checks and fixes its own work',
  'Save your code to GitHub',
  'Credits never expire',
];

function Pricing({ focusPrompt }: { focusPrompt: () => void }) {
  return (
    <section id="pricing" className="scroll-mt-24 bg-[var(--cream)] py-32 md:py-40">
      <Reveal className="mx-auto max-w-[680px] px-5 text-center">
        <h2 className="text-[clamp(40px,5.4vw,68px)] font-bold leading-[1.05] tracking-[-0.03em]">Free To Start. Clear Cost.</h2>
        <p className="mx-auto mt-6 max-w-[40ch] text-[18px] font-medium leading-[1.45] text-[var(--muted)]">
          Start building for free. Use your own AI key whenever you want more.
        </p>
      </Reveal>

      <div className="mx-auto mt-20 grid max-w-[960px] gap-6 px-5 md:grid-cols-2 md:px-8">
        <Reveal className="rounded-[18px] bg-[var(--ink)] p-8 text-white md:p-10">
          <span className="inline-block rounded-[4px] bg-[var(--lime)] px-2 py-0.5 text-[13px] font-bold uppercase text-[var(--ink)]">Free plan</span>
          <p className="mt-6 text-[56px] font-bold leading-none tracking-[-0.03em]">
            $0<span className="ml-1 align-top text-[13px] font-bold">USD</span>
          </p>
          <p className="mt-3 text-[15px] font-medium text-white/75">100 credits to build with, no card needed</p>
          <ul className="mt-8 space-y-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[15.5px] font-medium">
                <CheckCircle size={18} weight="fill" className="text-[var(--lime)]" />
                {item}
              </li>
            ))}
          </ul>
          <button
            onClick={focusPrompt}
            className="mt-10 w-full rounded-[8px] border-2 border-[var(--lime)] bg-[var(--lime)] py-3 text-[13px] font-bold uppercase text-[var(--ink)] transition-transform hover:-translate-y-0.5"
          >
            Start building
          </button>
        </Reveal>

        <Reveal delay={0.08} className="flex flex-col rounded-[18px] bg-[var(--lime)] p-8 text-[var(--ink)] md:p-10">
          <span className="inline-block w-fit rounded-[4px] bg-[var(--ink)] px-2 py-0.5 text-[13px] font-bold uppercase text-[var(--lime)]">Your own AI key</span>
          <p className="mt-6 text-[24px] font-bold leading-[1.25] tracking-[-0.01em]">
            Plug in your own key and build on your own account, as much as you like.
          </p>
          <ul className="mt-8 space-y-3">
            {['OpenRouter, OpenAI or Anthropic', 'Key checked before it is saved', 'Encrypted, never shown again'].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[15.5px] font-medium">
                <CheckCircle size={18} weight="fill" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-10 text-[14px] font-medium leading-[1.45] opacity-75">
            Optional. Switch to it any time, including when your free credits run low.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const COMPARE = [
  { label: 'Time to first version', us: 'Minutes', dev: '4 to 12 weeks', agency: '3 to 6+ months', diy: 'If you find the time' },
  { label: 'Cost to start', us: 'Free', dev: '$3k to $10k', agency: '$10k to $30k+', diy: 'Your time and sanity' },
  { label: 'Changes', us: 'Just ask in the chat', dev: 'Paid revisions', agency: 'Change requests', diy: 'All on you' },
  { label: 'Coding needed', us: 'None', dev: 'None', agency: 'None', diy: 'A lot' },
  { label: 'Own your code', us: 'Save to GitHub', dev: 'Usually', agency: 'Sometimes', diy: 'Yes' },
];

const COLUMNS: [string, boolean][] = [
  ['Inkling', true],
  ['Hire a developer', false],
  ['Agency', false],
  ['Code it yourself', false],
];

function Compare() {
  return (
    <section id="why" className="scroll-mt-24 bg-[var(--cream)] pb-36 md:pb-44">
      <div className="mx-auto max-w-[1312px] px-5 md:px-8">
        <Reveal className="mx-auto max-w-[720px] text-center">
          <h2 className="text-[clamp(38px,5vw,64px)] font-bold leading-[1.05] tracking-[-0.03em]">
            The Smarter Way to Get Your App Built.
          </h2>
          <p className="mx-auto mt-6 max-w-[44ch] text-[18px] font-medium leading-[1.45] text-[var(--muted)]">
            No waiting on a developer, no agency invoice, no learning to code.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-16 xl:mt-20">
          <table className="hidden w-full text-left xl:table">
            <caption className="sr-only">How Inkling compares with hiring a developer, an agency or coding it yourself</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[18%] pb-8">
                  <span className="sr-only">What you get</span>
                </th>
                {COLUMNS.map(([label, us]) => (
                  <th key={label} scope="col" className="pb-8">
                    <span
                      className={`inline-block rounded-[4px] px-2 py-1 text-[13px] font-bold uppercase ${
                        us ? 'bg-[var(--lime)] text-[var(--ink)]' : 'bg-[var(--ink)] text-white'
                      }`}
                    >
                      {label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.label} className="border-b border-[var(--dash)] last:border-b-0">
                  <th scope="row" className="py-7 pl-5 text-[13px] font-bold uppercase text-[var(--muted)]">{row.label}</th>
                  <td className="py-7">
                    <span className="flex items-center gap-2 text-[17px] font-bold">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--lime)] text-[var(--ink)]">
                        <Check size={11} weight="bold" />
                      </span>
                      {row.us}
                    </span>
                  </td>
                  {[row.dev, row.agency, row.diy].map((value, index) => (
                    <td key={index} className="py-7">
                      <span className="flex items-center gap-2 text-[17px] font-medium text-[var(--muted)]">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--soft-3)]">
                          <X size={10} weight="bold" className="text-white" />
                        </span>
                        {value}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid gap-5 sm:grid-cols-2 xl:hidden">
            {COMPARE.map((row) => (
              <div key={row.label} className="rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] p-5 sm:last:col-span-2">
                <p className="text-[12.5px] font-bold uppercase text-[var(--muted)]">{row.label}</p>
                <p className="mt-3 flex items-center gap-2 rounded-[8px] bg-[var(--lime)] px-3 py-2.5 text-[16px] font-bold text-[var(--ink)]">
                  <Check size={14} weight="bold" className="shrink-0" />
                  <span className="text-[12px] uppercase">Inkling</span>
                  <span className="ml-auto text-right">{row.us}</span>
                </p>
                <dl className="mt-3 space-y-2 px-1">
                  {[
                    [COLUMNS[1]![0], row.dev],
                    [COLUMNS[2]![0], row.agency],
                    [COLUMNS[3]![0], row.diy],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4 text-[14.5px]">
                      <dt className="font-medium text-[var(--muted)]">{label}</dt>
                      <dd className="text-right font-bold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const GALLERY = [
  { art: 'Candle Shop', prompt: 'An online shop for my handmade candles' },
  { art: 'Yoga Class Booking', prompt: 'A booking page for my yoga classes' },
  { art: 'Habit Tracker', prompt: 'A habit tracker with daily streaks' },
  { art: 'Wedding RSVP', prompt: 'A wedding website with an RSVP form' },
  { art: 'Family Recipe Box', prompt: 'A recipe box for our family recipes' },
  { art: 'Photography Portfolio', prompt: 'A portfolio site for my photography' },
];

function Gallery({ focusPrompt }: { focusPrompt: (text?: string) => void }) {
  return (
    <section className="bg-[var(--ink)] py-32 text-white md:py-40">
      <div className="mx-auto max-w-[1312px] px-5 md:px-8">
        <Reveal className="max-w-[640px]">
          <h2 className="text-[clamp(32px,3.6vw,48px)] font-bold leading-[1.08] tracking-[-0.02em]">Things People Build First.</h2>
          <p className="mt-5 max-w-[42ch] text-[17px] font-medium leading-[1.5] text-white/70">
            Every one of these started as a single sentence. Tap one to start from it.
          </p>
        </Reveal>
        <div className="mt-16 grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 md:gap-x-8 md:gap-y-10">
          {GALLERY.map((tile, index) => (
            <Reveal key={tile.art} delay={(index % 3) * 0.06} className={index === 0 ? 'col-span-2 md:row-span-2' : index === GALLERY.length - 1 ? 'col-span-2 md:col-span-1' : ''}>
              <button onClick={() => focusPrompt(tile.prompt)} className="group flex h-full w-full flex-col text-left">
                <span className={`block overflow-hidden rounded-[10px] bg-[var(--cream)] ${index === 0 ? 'aspect-[4/3] md:aspect-auto md:flex-1' : 'aspect-[4/3]'}`}>
                  <img
                    src={sitePhoto(tile.art)}
                    alt={`${tile.art} website built with Inkling`}
                    loading="lazy"
                    className="h-full w-full object-cover object-left-top transition-transform duration-700 group-hover:scale-[1.04]"
                  />
                </span>
                <span className="mt-3 inline-flex items-center gap-1.5 text-[15px] font-bold leading-tight transition-colors group-hover:text-[var(--lime)]">
                  {tile.art}
                  <ArrowUpRight size={14} weight="bold" className="shrink-0" />
                </span>
              </button>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: 'How do credits work?',
    a: 'Every account starts with 100 free credits. Each build uses a few, depending on how much work it takes. You can always see how many are left.',
  },
  {
    q: 'What happens when my credits run out?',
    a: 'Your work is saved. You can ask for more credits with one click, which drafts the email for you, or add your own AI key and keep building.',
  },
  { q: 'Can I use my own AI key?', a: 'Yes. Connect an OpenRouter, OpenAI or Anthropic key. It is checked before saving, encrypted, and you can remove it any time.' },
  { q: 'Do I own the code?', a: 'Yes. It is a real Next.js project. Save it to your own GitHub repository whenever you like and take it anywhere.' },
  { q: 'What if something breaks?', a: 'It checks every page after each change. If it finds a problem, it reads the error and fixes it before handing back to you.' },
  {
    q: 'What can I build with it?',
    a: 'Booking pages, online shops, dashboards, trackers, event pages, portfolios and more. If your app needs a service like payments or email, it asks for that key first.',
  },
];

function Faqs() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faqs" className="relative scroll-mt-24 bg-[var(--ink)] pb-36">
      <div aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[55%] bg-[var(--paper)] [clip-path:polygon(0_18%,100%_0,100%_100%,0_100%)]" />
      <Reveal className="relative mx-auto max-w-[1040px] px-5 md:px-8">
        <div className="rounded-[18px] border-2 border-[var(--edge)] bg-[var(--lime)] p-6 md:p-14">
          <h2 className="text-[clamp(44px,5vw,64px)] font-bold tracking-[-0.03em]">FAQs</h2>
          <div className="mt-12 border-t border-[var(--edge)]/70">
            {FAQS.map((item, index) => (
              <div key={item.q} className="border-b border-[var(--edge)]/70">
                <button
                  onClick={() => setOpen(open === index ? null : index)}
                  aria-expanded={open === index}
                  className="flex w-full items-center justify-between gap-4 px-2 py-6 text-left text-[17px] font-bold md:px-5 md:text-[18px]"
                >
                  {item.q}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--lime)] transition-transform duration-300 ${
                      open === index ? 'rotate-180' : ''
                    }`}
                  >
                    <CaretDown size={13} weight="bold" />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {open === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-[70ch] px-2 pb-6 text-[16px] font-medium leading-[1.5] md:px-5">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function FinalCta(props: Props) {
  return (
    <section className="bg-[var(--paper)] pb-36 pt-16 md:pb-44">
      <Reveal className="mx-auto max-w-[760px] px-5 text-center">
        <h2 className="text-[clamp(32px,5vw,60px)] font-bold leading-[1.05] tracking-[-0.03em]">
          Your App Won&rsquo;t Build Itself.
          <br />
          Good Thing We Will.
        </h2>
        <p className="mx-auto mt-6 max-w-[40ch] text-[18px] font-medium leading-[1.45] text-[var(--muted)]">
          Sign in for free and watch your idea come to life.
        </p>
      </Reveal>
      <Reveal delay={0.1} className="mx-auto mt-16 max-w-[760px] px-5">
        <div className="rounded-[18px] border-2 border-[var(--edge)] bg-[var(--lime)] p-6 shadow-[6px_6px_0_var(--edge)] md:p-10">
          <label htmlFor="lime-final" className="sr-only">
            Describe the app you want
          </label>
          <textarea
            id="lime-final"
            value={props.prompt}
            onChange={(e) => props.setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                props.start();
              }
            }}
            rows={3}
            placeholder="Describe your app. For example: a website for my bakery with a menu, opening hours and cake orders"
            className="block w-full resize-none rounded-[10px] border-2 border-[var(--edge)] bg-[#f3f2ea] px-4 py-3 text-[15px] font-medium outline-none placeholder:text-[#7b7c74] focus:bg-white"
          />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <LimeButton dark onClick={props.start} disabled={props.busy}>
              {props.busy ? 'Starting' : 'Start building'}
            </LimeButton>
            <p className="flex items-center gap-2 text-[14px] font-bold leading-tight">
              <CheckCircle size={18} weight="fill" />
              100 free credits, no card needed
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer({ focusPrompt }: { focusPrompt: () => void }) {
  return (
    <footer className="relative overflow-hidden rounded-t-[24px] bg-[var(--footer)] pb-6 pt-20 text-white">
      <div className="mx-auto grid max-w-[1312px] grid-cols-2 gap-x-8 gap-y-12 px-5 md:grid-cols-[1fr_auto_auto] md:gap-x-16 md:px-8">
        <div className="col-span-2 md:col-span-1">
          <Logo size="lg" invert />
          <p className="mt-5 max-w-[34ch] text-[16px] font-medium leading-[1.35] text-white/85">
            Describe an app, watch it get built. Real code, live preview, yours to keep.
          </p>
          <div className="mt-7">
            <LimeButton onClick={focusPrompt}>Start building</LimeButton>
          </div>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase text-white/70">Navigation</p>
          <ul className="mt-2 text-[17px] font-medium">
            {SECTIONS.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="inline-flex min-h-[40px] items-center transition-colors hover:text-[var(--lime)]">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase text-white/70">Code</p>
          <a
            href="https://github.com/deepanshuliv/my-lovable"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            className="mt-4 flex h-11 w-11 items-center justify-center rounded-[6px] bg-white text-[#1c1d1a] transition-colors hover:bg-[var(--lime)]"
          >
            <GithubLogo size={24} weight="fill" />
          </a>
        </div>
      </div>
      <p aria-hidden="true" className="before:content-['Inkling'] pointer-events-none mt-16 select-none whitespace-nowrap text-center text-[clamp(80px,17vw,250px)] font-black leading-[0.8] tracking-[-0.05em] text-white/[0.06]"></p>
    </footer>
  );
}

export default function LimeLanding(props: Props) {
  const go = () => props.focusPrompt();
  return (
    <div className="bg-[var(--paper)] text-[var(--text)]">
      <Nav isLoaded={props.isLoaded} isSignedIn={props.isSignedIn} focusPrompt={props.focusPrompt} />
      <main>
        <Hero {...props} />
        <DemoSection />
        <Checklist />
        <Simple />
        <Pricing focusPrompt={go} />
        <Compare />
        <Gallery focusPrompt={props.focusPrompt} />
        <Faqs />
        <FinalCta {...props} />
      </main>
      <Footer focusPrompt={go} />
    </div>
  );
}
