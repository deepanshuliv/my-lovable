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
  Square,
  X,
} from '@phosphor-icons/react';
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { sitePhoto } from '@/components/ProjectArt';
import { Bubble, EASE, LimeButton, Logo, Note, Polaroid } from '@/components/lime';
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

function Nav({ isLoaded, isSignedIn, focusPrompt }: Pick<Props, 'isLoaded' | 'isSignedIn' | 'focusPrompt'>) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById('lime-top');
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-sticky)]">
      <div className="mx-auto flex h-[84px] w-full max-w-[1312px] items-center justify-between px-5 md:px-8">
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
                className="hidden items-center gap-7 rounded-[10px] bg-[var(--ink)] px-6 py-3 text-[12.5px] font-bold uppercase text-white lg:flex"
                aria-label="Sections"
              >
                <a href="#how" className="transition-colors hover:text-[var(--lime)]">How it works</a>
                <a href="#pricing" className="transition-colors hover:text-[var(--lime)]">Pricing</a>
                <a href="#why" className="transition-colors hover:text-[var(--lime)]">Why us</a>
                <a href="#faqs" className="transition-colors hover:text-[var(--lime)]">FAQs</a>
              </motion.nav>
            )}
          </AnimatePresence>
          {isLoaded && !isSignedIn && (
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="hidden rounded-[10px] bg-[var(--ink)] px-4 py-3 text-[12.5px] font-bold uppercase text-white transition-colors hover:text-[var(--lime)] sm:block">
                Sign in
              </button>
            </SignInButton>
          )}
          {isLoaded && isSignedIn ? (
            <>
              <Link
                href="/dashboard"
                className="flex items-center gap-3 rounded-[10px] bg-[var(--ink)] py-1.5 pl-4 pr-1.5 text-[12.5px] font-bold uppercase text-white"
              >
                Dashboard
                <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--lime)] text-[var(--ink)]">
                  <ArrowRight size={14} weight="bold" />
                </span>
              </Link>
              <span className="ml-1 flex h-9 items-center">
                <UserButton />
              </span>
            </>
          ) : (
            <button
              onClick={() => focusPrompt()}
              className="flex items-center gap-3 rounded-[10px] bg-[var(--ink)] py-1.5 pl-4 pr-1.5 text-[12.5px] font-bold uppercase text-white"
            >
              Start building
              <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--lime)] text-[var(--ink)]">
                <ArrowRight size={14} weight="bold" />
              </span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

const POLAROIDS = [
  { name: 'Yoga Class Booking', x: 'calc(50% - 476px)', y: '11%', r: 4, depth: 18, w: 'w-[210px]', delay: 0 },
  { name: 'Candle Shop', x: 'max(2%, calc(50% - 680px))', y: '40%', r: -9, depth: 28, w: 'w-[220px]', delay: 0.08 },
  { name: 'Team Dashboard', x: 'calc(50% + 424px)', y: '14%', r: 18, depth: 16, w: 'w-[210px]', delay: 0.16, show: 'min-[1400px]:block' },
  { name: 'Wedding RSVP', x: 'calc(50% - 590px)', y: '67%', r: -6, depth: 14, w: 'w-[210px]', delay: 0.24 },
  { name: 'Habit Tracker', x: 'calc(50% + 384px)', y: '63%', r: -10, depth: 14, w: 'w-[210px]', delay: 0.32 },
];

function FloatingPolaroid({ item, mx, my }: { item: (typeof POLAROIDS)[number]; mx: ReturnType<typeof useSpring>; my: ReturnType<typeof useSpring> }) {
  const x = useTransform(mx, (v) => v * item.depth);
  const y = useTransform(my, (v) => v * item.depth);
  return (
    <motion.div className={`absolute hidden ${(item as { show?: string }).show ?? 'md:block'}`} style={{ left: item.x, top: item.y, x, y }}>
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
      className="relative overflow-hidden pb-24 pt-[140px] md:flex md:h-[100dvh] md:min-h-[680px] md:flex-col md:justify-center md:pb-10 md:pt-[88px]"
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
        className="absolute left-1/2 top-[-12%] aspect-square w-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-[var(--soft)]"
      />
      <motion.div
        aria-hidden="true"
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 120, ease: 'linear', repeat: Infinity }}
        className="absolute left-1/2 top-[-4%] hidden aspect-square w-[min(960px,130vw)] -translate-x-1/2 rounded-full border-2 border-dashed border-[var(--dash)] md:block"
      />
      {POLAROIDS.map((item) => (
        <FloatingPolaroid key={item.name} item={item} mx={mx} my={my} />
      ))}
      <Note className="left-[calc(50%+360px)] top-[53%] hidden xl:flex" arrow="down-left">Yes, it writes real code!</Note>

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
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mt-12 text-[13px] font-bold uppercase tracking-[0.02em]"
        >
          One sentence. One app. Live in minutes.
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.12, ease: EASE }}
          className="mt-5 text-[clamp(44px,5.8vw,80px)] font-bold leading-[1.02] tracking-[-0.035em]"
        >
          Your App,
          <br />
          Built While You Watch.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
          className="mt-6 max-w-[52ch] text-[18px] font-medium leading-[1.4]"
        >
          Describe it in plain words. Inkling writes the code, runs it in a private workspace and shows you the
          live app. No coding, no setup.
        </motion.p>

        <motion.div
          id="start"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.28, ease: EASE }}
          className="mt-9 w-full max-w-[640px] scroll-mt-32 text-left"
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
              placeholder="What do you want to make? For example: a booking page for my yoga classes"
              className="block w-full resize-none bg-transparent px-3 pt-2 text-[16px] font-medium leading-relaxed outline-none placeholder:text-[var(--faint)]"
            />
            <div className="flex items-center justify-between gap-3 pl-3">
              <span className="text-[12.5px] font-medium text-[var(--muted)]">Press Enter to start</span>
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
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {['Booking page for my yoga classes', 'Online shop for my candles', 'Habit tracker with streaks'].map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  props.setPrompt(tag);
                  props.inputRef.current?.focus();
                }}
                className="rounded-[8px] border-2 border-[var(--edge)] bg-[var(--panel)] px-2.5 py-1 text-[12.5px] font-bold transition-colors hover:bg-[var(--lime)]"
              >
                {tag}
              </button>
            ))}
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-[13px] font-medium">
            <CheckCircle size={16} weight="fill" />
            100 free credits, no card needed
          </p>
        </motion.div>
      </div>

      <div className="mt-14 flex justify-center gap-4 px-5 md:hidden">
        <Polaroid name="Yoga Class Booking" className="w-[44%] -rotate-6" />
        <Polaroid name="Candle Shop" className="mt-6 w-[44%] rotate-6" />
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
    <section className="px-4 pt-24 md:px-8 md:pt-32">
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
                  <span className={`flex-1 transition-colors duration-300 ${isDone ? 'text-white/45 line-through decoration-[var(--lime)] decoration-2' : 'text-white/90'}`}>
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
          <Bubble className="left-[30%] top-[14%] -rotate-3">I just wanted a booking page</Bubble>
        </div>
        <div className="relative flex flex-col justify-center px-6 py-14 md:px-12">
          <p className="text-[16px] font-medium">Sound familiar?</p>
          <h2 className="mt-5 max-w-[15ch] text-[clamp(32px,3.4vw,44px)] font-bold leading-[1.12] tracking-[-0.02em]">
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

const PHASES = ['Describe', 'Quick question', 'Writing the code', 'Checking', 'Live preview'];

const STEPS = [
  { n: 1, title: 'You describe it', body: 'Type your idea in plain words, like you would text a friend.', col: '1 / 2', row: '1' },
  { n: 2, title: 'It asks, if needed', body: 'Unclear bits get a quick multiple choice question. No guessing.', col: '2 / 3', row: '2' },
  { n: 3, title: 'It writes the code', body: 'Pages, components and data, written in real Next.js. You see every step in the chat.', col: '2 / 4', row: '3' },
  { n: 4, title: 'It checks every page', body: 'Loads each page and checks the code before calling it done.', col: '4 / 5', row: '3' },
  { n: 5, title: 'It fixes problems', body: 'If something breaks, it reads the error and repairs it on its own.', col: '4 / 5', row: '4' },
  { n: 6, title: 'Your app is live', body: 'The preview updates. Ask for changes, as many as you like.', col: '5 / 6', row: '4' },
];

function startColumn(col: string): number {
  return Number(col.split('/')[0]!.trim()) - 1;
}

function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start 75%', 'end 55%'] });
  const head = useTransform(scrollYProgress, [0, 1], [0, 5]);
  const left = useTransform(head, (v) => `${Math.min(99.6, v * 20)}%`);
  const [reached, setReached] = useState(reduced ? 5 : 0);

  useMotionValueEvent(head, 'change', (value) => {
    if (reduced) return;
    setReached((prev) => (Math.abs(prev - value) < 0.05 ? prev : value));
  });

  return (
    <section id="how" className="scroll-mt-24 bg-[var(--soft)] pt-28">
      <div className="mx-auto max-w-[1312px] px-5 md:px-8">
        <Reveal className="relative text-center">
          <h2 className="flex flex-wrap items-center justify-center text-[clamp(38px,4.6vw,60px)] font-bold tracking-[-0.03em]">
            <span className="mr-3">Meet</span>
            <span className="rounded-[10px] bg-[var(--lime)] px-3 leading-[1.2] text-[var(--ink)]">Inkling</span>
          </h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-[17px] font-medium leading-[1.45]">
            Your idea goes in, a working app comes out. Scroll to play one build, start to finish.
          </p>
          <div className="mx-auto mt-7 flex max-w-[620px] flex-wrap justify-center gap-2">
            {['No coding needed', 'Live preview as it builds', 'Real Next.js code', 'Save it to GitHub'].map((pill) => (
              <span key={pill} className="tag bg-[var(--lime)] !normal-case !text-[13px]">
                <Check size={13} weight="bold" />
                {pill}
              </span>
            ))}
          </div>
          <Note className="right-[4%] top-[-10px] hidden lg:flex" arrow="down-left">
            Minutes, not months
          </Note>
        </Reveal>

        <div ref={trackRef} className="mt-16 hidden md:block">
          <div className="grid grid-cols-5 gap-x-3">
            {PHASES.map((phase, index) => (
              <p
                key={phase}
                className={`py-1.5 text-center text-[12.5px] font-bold uppercase transition-colors duration-300 ${
                  reached > index ? 'bg-[var(--ink)] text-[var(--lime)]' : 'bg-[var(--soft-2)]'
                }`}
              >
                {phase}
              </p>
            ))}
          </div>
          <div className="relative grid grid-cols-5 gap-x-3 gap-y-3 pb-24 pt-10" style={{ gridTemplateRows: 'repeat(4, minmax(110px, auto))' }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="pointer-events-none absolute inset-y-0 w-px bg-[var(--hairline)]" style={{ left: `calc(${(i + 1) * 20}% - 1px)` }} />
            ))}
            <motion.div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[2] w-[2px] bg-[var(--ink)]" style={{ left }}>
              <span className="absolute -left-[22px] -top-3 rounded-[4px] bg-[var(--ink)] px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-[var(--lime)]">
                Now
              </span>
              <span className="absolute -bottom-1 -left-[5px] h-3 w-3 rounded-full border-2 border-[var(--edge)] bg-[var(--lime)]" />
            </motion.div>
            {STEPS.map((step) => {
              const active = reached > startColumn(step.col) + 0.15;
              return (
                <div
                  key={step.n}
                  style={{ gridColumn: step.col, gridRow: step.row }}
                  className={`relative z-[1] self-start rounded-[6px] border-2 p-4 transition-[background-color,box-shadow,transform,border-color,opacity] duration-500 ${
                    active
                      ? 'translate-x-0 border-[var(--edge)] bg-[var(--lime)] opacity-100 shadow-[var(--hard)]'
                      : 'translate-x-[-6px] border-dashed border-[var(--dash)] bg-transparent opacity-60 shadow-none'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-[16px] font-bold">{step.title}</h3>
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                        active ? 'bg-[var(--ink)] text-white' : 'bg-[var(--soft-3)] text-[var(--muted)]'
                      }`}
                    >
                      {active ? <Check size={11} weight="bold" /> : step.n}
                    </span>
                  </div>
                  <p className="mt-2 text-[14px] font-medium leading-[1.35]">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>

        <ol className="mt-12 space-y-3 pb-20 md:hidden">
          {STEPS.map((step) => (
            <li key={step.n} className="rounded-[6px] border-2 border-[var(--edge)] bg-[var(--lime)] p-4 shadow-[var(--hard)]">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold">{step.title}</h3>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ink)] text-[11px] font-bold text-white">{step.n}</span>
              </div>
              <p className="mt-2 text-[14px] font-medium">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <Marquee />
    </section>
  );
}

const MARQUEE = ['Real code', 'Live preview', '100 free credits', 'No coding needed', 'Bring your own AI key', 'Save to GitHub', 'Fixes its own bugs'];

function Marquee() {
  return (
    <div className="overflow-hidden bg-[var(--lime)] py-5">
      <div className="lime-marquee flex w-max">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
            {MARQUEE.map((item) => (
              <span key={item} className="flex items-center whitespace-nowrap text-[22px] font-bold uppercase">
                <span className="px-9">{item}</span>
                <span className="text-[14px]">●</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoSection() {
  return (
    <section id="demo" className="px-3 md:px-6">
      <div className="relative mx-auto max-w-[1360px] overflow-hidden rounded-[28px] bg-[var(--ink)] px-4 pb-14 pt-20 text-white md:px-10 md:pt-24">
        <Polaroid name="Recipe Box" shadow="#000" className="lime-float absolute left-[3%] top-[6%] hidden w-[200px] -rotate-[10deg] xl:block" />
        <Polaroid name="Team Dashboard" shadow="#000" className="lime-float absolute right-[3%] top-[4%] hidden w-[200px] rotate-[8deg] xl:block" />
        <Reveal className="mx-auto max-w-[680px] text-center">
          <p className="text-[13px] font-bold uppercase text-[var(--lime)]">The real product, start to finish</p>
          <h2 className="mt-5 text-[clamp(34px,4.4vw,58px)] font-bold leading-[1.06] tracking-[-0.03em]">
            One Sentence. That&rsquo;s All It Takes To Start.
          </h2>
          <p className="mx-auto mt-5 max-w-[50ch] text-[17px] font-medium leading-[1.45] text-white/75">
            Watch one real build: the request, the quick question, every file it writes, the checks, then the finished site.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="relative mx-auto mt-14 max-w-[1180px] text-[var(--text)]">
          <LiveDemo />
        </Reveal>
      </div>
    </section>
  );
}

const INCLUDED = [
  '100 free credits to start',
  'Unlimited projects',
  'Live preview while it builds',
  'Real Next.js code',
  'Checks and fixes its own work',
  'Save your code to GitHub',
  'Credits never expire',
];

const EXAMPLES = [
  'Yoga booking page',
  'Candle shop',
  'Habit tracker',
  'Wedding RSVP',
  'Team dashboard',
  'Recipe box',
  'Portfolio site',
  'Event tickets',
];

function Pricing({ focusPrompt }: { focusPrompt: (text?: string) => void }) {
  return (
    <section id="pricing" className="scroll-mt-24 bg-[var(--cream)] pb-24">
      <Reveal className="mx-auto max-w-[760px] px-5 text-center">
        <span className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--ink)] px-3 py-1.5 text-[14px] font-medium text-white">
          <Lightning size={15} weight="fill" className="text-[var(--lime)]" />
          No card needed
        </span>
        <h2 className="mt-8 text-[clamp(40px,5.4vw,68px)] font-bold leading-[1.05] tracking-[-0.03em]">Free To Start. Clear Cost.</h2>
        <p className="mt-4 text-[19px] font-medium leading-[1.35]">
          Start building for free. Use your own AI key whenever you want more.
        </p>
        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--edge)] px-3.5 py-1.5 text-[13px] font-bold">
          <span className="h-2 w-2 rounded-full bg-[var(--lime)] ring-1 ring-[var(--edge)]/30" />
          100 free credits for every new account
        </span>
      </Reveal>

      <div className="mx-auto mt-16 grid max-w-[1200px] gap-4 px-5 md:px-8 lg:grid-cols-3">
        <Reveal className="rounded-[18px] bg-[var(--ink)] p-6 text-white">
          <span className="inline-block rounded-[4px] bg-[var(--lime)] px-2 py-0.5 text-[13px] font-bold uppercase text-[var(--ink)]">Free plan</span>
          <p className="mt-4 text-[52px] font-bold leading-none tracking-[-0.03em]">
            $0<span className="ml-1 align-top text-[13px] font-bold">USD</span>
          </p>
          <p className="mt-2 text-[15px] font-medium">100 credits to build with</p>
          <button
            onClick={() => focusPrompt()}
            className="mt-6 w-full rounded-[8px] border-2 border-[var(--lime)] bg-[var(--lime)] py-3 text-[13px] font-bold uppercase text-[var(--ink)] transition-transform hover:-translate-y-0.5"
          >
            Start building
          </button>
          <div className="my-6 h-px bg-white/15" />
          <p className="text-[13px] font-bold uppercase">What&rsquo;s included:</p>
          <ul className="mt-4 space-y-2.5">
            {INCLUDED.map((item, index) => (
              <li key={item} className={`flex items-center gap-2.5 text-[15.5px] font-medium ${index === INCLUDED.length - 1 ? 'text-[var(--lime)]' : ''}`}>
                <CheckCircle size={18} weight="fill" className="text-[var(--lime)]" />
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <div className="flex flex-col gap-4">
          <Reveal delay={0.08} className="relative rounded-[18px] bg-[var(--lime)] p-6">
            <span className="absolute -top-4 right-10 rounded-full bg-[var(--ink)] px-4 py-2 text-[14px] font-bold text-white">Optional</span>
            <span className="inline-block rounded-[4px] bg-[var(--ink)] px-2 py-0.5 text-[13px] font-bold uppercase text-[var(--lime)]">Your own AI key</span>
            <p className="mt-4 text-[17px] font-bold leading-[1.3]">Plug in your own key and build on your own account, as much as you like.</p>
            <ul className="mt-5 space-y-2.5">
              {['OpenRouter, OpenAI or Anthropic', 'Pick from 3 models per provider', 'Key checked before it is saved', 'Encrypted, never shown again'].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-[15px] font-medium">
                  <CheckCircle size={18} weight="fill" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.14} className="flex-1 rounded-[14px] border-2 border-[var(--edge)] bg-[var(--panel)] p-6 shadow-[5px_5px_0_var(--edge)]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--edge)] bg-[var(--lime)] text-[15px] font-bold">!</span>
            <p className="mt-5 text-[16px] font-medium leading-[1.45]">
              Credits never reset, so nothing surprises you. Running low? One click drafts an email asking for more,
              or switch to your own key and keep going.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.2} className="rounded-[18px] bg-[#2a2b27] p-6 text-white">
          <h3 className="text-[44px] font-bold tracking-[-0.03em]">See Ideas</h3>
          <p className="mt-2 max-w-[24ch] text-[17px] font-medium leading-[1.3]">Things people build first. Tap one to start from it.</p>
          <div className="mt-10 flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => focusPrompt(`A ${example.toLowerCase()} for my business`)}
                className="inline-flex items-center gap-1.5 rounded-[6px] border border-white/40 px-3.5 py-2.5 text-[13px] font-bold uppercase transition-colors hover:border-[var(--lime)] hover:bg-[var(--lime)] hover:text-[var(--ink)]"
              >
                {example}
                <ArrowUpRight size={12} weight="bold" />
              </button>
            ))}
          </div>
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

function Compare({ focusPrompt }: { focusPrompt: () => void }) {
  return (
    <section id="why" className="scroll-mt-24 bg-[var(--cream)] py-24">
      <div className="mx-auto max-w-[1312px] px-5 md:px-8">
        <Reveal className="relative mx-auto max-w-[760px] text-center">
          <p className="text-[13px] font-bold uppercase">Why build with us?</p>
          <h2 className="mt-5 text-[clamp(38px,5vw,64px)] font-bold leading-[1.05] tracking-[-0.03em]">
            The Smarter Way to Get Your App Built.
          </h2>
          <p className="mx-auto mt-6 max-w-[52ch] text-[18px] font-medium leading-[1.4]">
            Whether you are comparing developers, agencies or learning to code yourself, Inkling removes the waiting,
            the cost and the guesswork.
          </p>
          <Note className="-right-36 -top-6 hidden xl:flex" arrow="down-left">
            It&rsquo;s a no-brainer, why wouldn&rsquo;t you?!
          </Note>
        </Reveal>

        <Reveal delay={0.1} className="mt-16 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr>
                <th className="w-[18%] pb-6" />
                {[
                  ['Inkling', true],
                  ['Hire a developer', false],
                  ['Agency', false],
                  ['Code it yourself', false],
                ].map(([label, us]) => (
                  <th key={String(label)} className="pb-6">
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
                <tr key={row.label} className="border-b border-[var(--dash)]">
                  <td className="py-5 pl-5 text-[13px] font-bold uppercase text-[var(--muted)]">{row.label}</td>
                  <td className="py-5">
                    <span className="flex items-center gap-2 text-[17px] font-bold">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--lime)]">
                        <Check size={11} weight="bold" />
                      </span>
                      {row.us}
                    </span>
                  </td>
                  {[row.dev, row.agency, row.diy].map((value, index) => (
                    <td key={index} className="py-5">
                      <span className="flex items-center gap-2 text-[17px] font-medium">
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
        </Reveal>

        <Reveal className="mt-20 text-center">
          <p className="text-[22px] font-bold leading-[1.2]">
            Ready to see your idea
            <br />
            working today?
          </p>
          <div className="mt-6">
            <LimeButton onClick={focusPrompt}>Start building</LimeButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const BENTO: ({ stat: string; title: string; body: string } | { art: string })[] = [
  { stat: '5', title: 'Steps, done for you', body: 'From your idea to a live preview, automatically' },
  { art: 'Candle Shop' },
  { art: 'Yoga Class Booking' },
  { art: 'Team Dashboard' },
  { art: 'Habit Tracker' },
  { art: 'Wedding RSVP' },
  { art: 'Family Recipe Box' },
  { stat: '100', title: 'Free credits', body: 'Enough to build and polish your first app' },
  { art: 'Photography Portfolio' },
  { stat: '3', title: 'AI providers', body: 'OpenRouter, OpenAI or Anthropic, your choice' },
  { art: 'Market Tickets' },
  { stat: '1 click', title: 'To GitHub', body: 'Take your code with you whenever you want' },
];

function Bento() {
  return (
    <section className="bg-[var(--ink)] py-28 text-white">
      <div className="mx-auto max-w-[1312px] px-5 md:px-8">
        <Reveal className="grid gap-8 md:grid-cols-2 md:items-end">
          <h2 className="text-[clamp(32px,3.6vw,48px)] font-bold leading-[1.08] tracking-[-0.02em]">
            Why Trust Us With
            <br />
            Your First App?
          </h2>
          <p className="max-w-[46ch] text-[16px] font-medium leading-[1.45] text-white/80">
            Inkling writes real code, runs it, checks every page and fixes what breaks. You only see the result, and
            the code is yours to keep.
          </p>
        </Reveal>
        <div className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-8">
          {BENTO.map((tile, index) => (
            <Reveal key={index} delay={(index % 4) * 0.06}>
              {'stat' in tile ? (
                <div className="flex aspect-square flex-col justify-end rounded-[6px] bg-[var(--lime)] p-5 text-[var(--ink)] md:p-6">
                  <p className="text-[clamp(40px,4.6vw,64px)] font-bold leading-none tracking-[-0.03em]">{tile.stat}</p>
                  <p className="mt-4 text-[16px] font-bold md:text-[18px]">{tile.title}</p>
                  <p className="mt-2 text-[13px] font-medium leading-[1.3] md:text-[15px]">{tile.body}</p>
                </div>
              ) : (
                <figure className="group relative aspect-square overflow-hidden rounded-[6px] bg-[#f3f2ea]">
                  <img
                    src={sitePhoto(tile.art)}
                    alt={`${tile.art} website built with Inkling`}
                    loading="lazy"
                    className="h-full w-full object-cover object-left-top transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                  <figcaption className="absolute bottom-3 left-3 rounded-[6px] bg-[var(--ink)] px-2.5 py-1 text-[12px] font-bold text-white">
                    {tile.art}
                  </figcaption>
                </figure>
              )}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: 'Who is Inkling a good fit for?',
    a: 'Anyone with an idea for a website or small app who does not want to learn to code: small business owners, creators, students and founders testing an idea.',
  },
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in plain words. If something is unclear, it asks you a quick question with options to pick from.' },
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
    <section id="faqs" className="relative scroll-mt-24 bg-[var(--ink)] pb-28">
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[55%] bg-[var(--paper)] [clip-path:polygon(0_18%,100%_0,100%_100%,0_100%)]" />
      <Reveal className="relative mx-auto max-w-[1312px] px-5 md:px-8">
        <div className="rounded-[18px] border-2 border-[var(--edge)] bg-[var(--lime)] p-6 md:p-10">
          <h2 className="text-[clamp(44px,5vw,64px)] font-bold tracking-[-0.03em]">FAQs</h2>
          <div className="mt-10 border-t border-[var(--edge)]/70">
            {FAQS.map((item, index) => (
              <div key={item.q} className="border-b border-[var(--edge)]/70">
                <button
                  onClick={() => setOpen(open === index ? null : index)}
                  aria-expanded={open === index}
                  className="flex w-full items-center justify-between gap-4 px-2 py-5 text-left text-[17px] font-bold md:px-5 md:text-[18px]"
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
    <section className="bg-[var(--paper)] pb-28 pt-8">
      <Reveal className="mx-auto max-w-[760px] px-5 text-center">
        <h2 className="text-[clamp(38px,5vw,60px)] font-bold leading-[1.05] tracking-[-0.03em]">
          Your App Won&rsquo;t Build Itself.
          <br />
          Good Thing We Will.
        </h2>
        <p className="mx-auto mt-5 max-w-[46ch] text-[18px] font-medium leading-[1.4]">
          One sentence is all it takes to start. Sign in for free and watch your idea come to life.
        </p>
      </Reveal>
      <Reveal delay={0.1} className="mx-auto mt-12 max-w-[800px] px-5">
        <div className="rounded-[18px] border-2 border-[var(--edge)] bg-[var(--lime)] p-6 shadow-[6px_6px_0_var(--edge)] md:p-8">
          <h3 className="text-[28px] font-bold tracking-[-0.02em]">Start your app</h3>
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
            className="mt-5 block w-full resize-none rounded-[10px] border-2 border-[var(--edge)] bg-[#f3f2ea] px-4 py-3 text-[15px] font-medium outline-none placeholder:text-[#7b7c74] focus:bg-white"
          />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <LimeButton dark onClick={props.start} disabled={props.busy}>
              {props.busy ? 'Starting' : 'Start building'}
            </LimeButton>
            <p className="flex items-center gap-2 text-[14px] font-bold leading-tight">
              <CheckCircle size={18} weight="fill" />
              100 free credits,
              <br />
              no card needed
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
      <div className="mx-auto grid max-w-[1312px] gap-12 px-5 md:grid-cols-[1fr_auto_auto] md:px-8">
        <div>
          <Logo size="lg" invert />
          <p className="mt-5 max-w-[34ch] text-[16px] font-medium leading-[1.35] text-white/85">
            Describe an app, watch it get built. Real code, live preview, yours to keep.
          </p>
          <div className="mt-7">
            <LimeButton onClick={focusPrompt}>Start building</LimeButton>
          </div>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase">Navigation</p>
          <ul className="mt-4 space-y-2.5 text-[17px] font-medium">
            <li><a href="#how" className="hover:text-[var(--lime)]">How it works</a></li>
            <li><a href="#pricing" className="hover:text-[var(--lime)]">Pricing</a></li>
            <li><a href="#why" className="hover:text-[var(--lime)]">Why us</a></li>
            <li><a href="#faqs" className="hover:text-[var(--lime)]">FAQs</a></li>
          </ul>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase">Code</p>
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
      <p aria-hidden="true" className="pointer-events-none mt-16 select-none whitespace-nowrap text-center text-[clamp(80px,17vw,250px)] font-black leading-[0.8] tracking-[-0.05em] text-white/[0.06]">
        Inkling
      </p>
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
        <Simple focusPrompt={go} />
        <Timeline />
        <Pricing focusPrompt={props.focusPrompt} />
        <Compare focusPrompt={go} />
        <Bento />
        <Faqs />
        <FinalCta {...props} />
      </main>
      <Footer focusPrompt={go} />
    </div>
  );
}
