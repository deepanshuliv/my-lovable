'use client';

import { ArrowUp, Check, GithubLogo, WarningCircle, Wrench } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EASE } from '@/components/lime';

function useTicker(steps: number, ms: number) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [step, setStep] = useState(reduced ? steps - 1 : 0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || reduced) return;
    const timer = setInterval(() => setStep((value) => (value + 1) % steps), ms);
    return () => clearInterval(timer);
  }, [visible, reduced, steps, ms]);

  return { ref, step };
}

function Card({
  title,
  body,
  tone = 'paper',
  className = '',
  children,
  innerRef,
}: {
  title: string;
  body: string;
  tone?: 'paper' | 'lime' | 'ink';
  className?: string;
  children: ReactNode;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const tones = {
    paper: 'bg-[var(--panel)] text-[var(--text)]',
    lime: 'bg-[var(--lime)] text-[var(--ink)]',
    ink: 'bg-[var(--ink)] text-white',
  };
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: EASE }}
      className={`group flex h-full flex-col overflow-hidden rounded-[16px] border-2 border-[var(--edge)] shadow-[var(--hard)] transition-transform duration-200 hover:-translate-y-1 ${tones[tone]} ${className}`}
    >
      <div ref={innerRef} className="relative min-h-[190px] flex-1 p-5">
        {children}
      </div>
      <div className={`border-t-2 border-[var(--edge)] px-5 py-4 ${tone === 'ink' ? 'border-white/15' : ''}`}>
        <h3 className="text-[18px] font-bold leading-tight tracking-[-0.01em]">{title}</h3>
        <p className={`mt-1 text-[14px] font-medium leading-snug ${tone === 'ink' ? 'text-white/70' : 'opacity-75'}`}>{body}</p>
      </div>
    </motion.article>
  );
}

const PROMPTS = ['A booking page for my yoga classes', 'An online shop for my candles', 'A wedding RSVP with a guest list'];

function Describe() {
  const { ref, step } = useTicker(PROMPTS.length * 30, 70);
  const prompt = PROMPTS[Math.floor(step / 30)]!;
  const local = step % 30;
  const typed = prompt.slice(0, Math.round((Math.min(local, 22) / 22) * prompt.length));
  const ready = local >= 22;
  return (
    <Card innerRef={ref} title="No coding. You just describe it." body="Type your idea the way you would text a friend." tone="lime">
      <div className="flex h-full flex-col justify-center gap-3">
        <div className="rounded-[12px] border-2 border-[var(--ink)] bg-white p-3 shadow-[3px_3px_0_var(--ink)]">
          <p className="min-h-[44px] text-[15px] font-medium leading-snug text-[var(--ink)]">
            {typed}
            <span className="demo-caret ml-0.5 inline-block h-[17px] w-[2px] translate-y-[3px] bg-[var(--ink)]" />
          </p>
          <div className="mt-2 flex justify-end">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-[8px] border-2 border-[var(--ink)] transition-all duration-300 ${
                ready ? 'scale-110 bg-[var(--ink)] text-[var(--lime)]' : 'bg-white text-[var(--ink)]'
              }`}
            >
              <ArrowUp size={14} weight="bold" />
            </span>
          </div>
        </div>
        <p className={`font-scrawl text-[17px] text-[var(--ink)] transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}>that is all it needs!</p>
      </div>
    </Card>
  );
}

const OPTIONS = ['Pay when they arrive', 'Pay online with a card', 'Free, just reserve'];

function Asks() {
  const { ref, step } = useTicker(6, 750);
  const hovered = step < 3 ? step : 1;
  const picked = step >= 3;
  return (
    <Card innerRef={ref} title="It asks before it guesses." body="Unclear bits become one quick question, never a wrong build.">
      <div className="rounded-[12px] border-2 border-[var(--edge)] bg-[var(--panel)]">
        <p className="rounded-t-[10px] border-b-2 border-[var(--edge)] bg-[var(--lime)] px-3 py-1.5 text-[12px] font-bold text-[var(--ink)]">Quick question</p>
        <div className="space-y-1.5 p-3">
          <p className="mb-2 text-[14px] font-bold">How should people pay for a class?</p>
          {OPTIONS.map((option, index) => (
            <div
              key={option}
              className={`flex items-center justify-between rounded-[8px] border-2 px-3 py-1.5 text-[13px] font-medium transition-all duration-300 ${
                picked && index === 1
                  ? 'border-[var(--edge)] bg-[var(--lime)] text-[var(--ink)]'
                  : !picked && hovered === index
                    ? 'translate-x-1 border-[var(--edge)]'
                    : 'border-[var(--line-strong)]'
              }`}
            >
              {option}
              {picked && index === 1 && <Check size={13} weight="bold" />}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Fixes() {
  const { ref, step } = useTicker(4, 1100);
  return (
    <Card innerRef={ref} title="It fixes its own mistakes." body="It checks every page, reads any error and repairs it.">
      <div className="space-y-2 rounded-[10px] bg-[#1c1d1a] p-3 font-mono ring-1 ring-white/10 text-[12px] leading-relaxed">
        <p className="flex items-center gap-2 text-[#ff8b7e]">
          <WarningCircle size={14} weight="fill" />
          price is not defined in Menu.tsx
        </p>
        <p className={`flex items-center gap-2 text-white/75 transition-opacity duration-500 ${step >= 1 ? 'opacity-100' : 'opacity-0'}`}>
          <Wrench size={14} />
          adding a price to each class…
        </p>
        <p className={`flex items-center gap-2 text-[var(--lime)] transition-opacity duration-500 ${step >= 2 ? 'opacity-100' : 'opacity-0'}`}>
          <Check size={14} weight="bold" />
          fixed. every page loads.
        </p>
      </div>
      <span
        className={`mt-3 inline-flex items-center gap-1.5 rounded-[6px] border-2 border-[var(--edge)] px-2 py-1 text-[11.5px] font-bold uppercase transition-all duration-500 ${
          step >= 2 ? 'bg-[var(--lime)] text-[var(--ink)]' : 'text-[var(--muted)]'
        }`}
      >
        {step >= 2 ? 'No action needed from you' : 'Checking your app'}
      </span>
    </Card>
  );
}

const CODE = [
  ['export function ', 'BookButton', '() {'],
  ['  return <', 'button', ' className="cta">'],
  ['    Book a class', '', ''],
  ['  </', 'button', '>;'],
  ['}', '', ''],
];

function Code() {
  const { ref, step } = useTicker(8, 600);
  const lines = Math.min(step + 1, CODE.length);
  const saved = step >= CODE.length + 1;
  return (
    <Card innerRef={ref} title="Real code you can keep." body="A proper Next.js project. Save it to your GitHub any time." tone="lime">
      <div className="rounded-[10px] border-2 border-[var(--ink)] bg-[#1c1d1a] p-3 font-mono text-[12px] leading-[1.7] text-white/85">
        {CODE.slice(0, lines).map(([a, b, c], index) => (
          <p key={index} className="rise-in whitespace-pre">
            <span className="text-[#c792ea]">{a}</span>
            <span className="text-[var(--lime)]">{b}</span>
            <span>{c}</span>
          </p>
        ))}
      </div>
      <span
        className={`mt-3 inline-flex items-center gap-1.5 rounded-[8px] border-2 border-[var(--ink)] bg-white px-2.5 py-1 text-[12px] font-bold text-[var(--ink)] shadow-[2px_2px_0_var(--ink)] transition-all duration-500 ${
          saved ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        <GithubLogo size={14} weight="fill" />
        Saved to GitHub
      </span>
    </Card>
  );
}

function Change() {
  const { ref, step } = useTicker(5, 1100);
  const changed = step >= 2;
  return (
    <Card innerRef={ref} title="Change anything by asking." body="No menus to learn. Say what you want different and watch it update.">
      <div className="grid h-full grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_1.3fr]">
        <div className="space-y-2">
          <p className="ml-auto w-fit max-w-[240px] rounded-[12px] rounded-br-[3px] border-2 border-[var(--edge)] bg-[var(--lime)] px-3 py-2 text-[13.5px] font-medium text-[var(--ink)]">
            Make the button orange and say &ldquo;Book your first class free&rdquo;
          </p>
          <p className={`flex items-center gap-2 text-[13px] font-medium text-[var(--muted)] transition-opacity duration-300 ${step >= 1 ? 'opacity-100' : 'opacity-0'}`}>
            <span className={`h-3 w-3 rounded-full border-2 border-[var(--edge)] ${changed ? 'bg-[var(--lime)]' : 'animate-spin border-t-[var(--lime)]'}`} />
            {changed ? 'Updated Hero.tsx' : 'Editing Hero.tsx…'}
          </p>
        </div>
        <div className="overflow-hidden rounded-[12px] border-2 border-[var(--edge)] bg-[#f6f1ea] p-4 text-[#2d2a26]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">Sunrise Yoga</span>
            <span className="h-1.5 w-16 rounded-full bg-[#2d2a26]/15" />
          </div>
          <p className="mt-4 text-[20px] font-bold leading-tight">Slow mornings, strong bodies.</p>
          <motion.span
            key={changed ? 'new' : 'old'}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="mt-3 inline-block rounded-full px-4 py-2 text-[13px] font-semibold text-white"
            style={{ background: changed ? '#f26b3a' : '#2d2a26' }}
          >
            {changed ? 'Book your first class free' : 'Book a class'}
          </motion.span>
        </div>
      </div>
    </Card>
  );
}

export default function Simple() {
  return (
    <section id="how" className="mx-auto max-w-[1312px] scroll-mt-24 px-5 py-36 md:px-8 lg:py-48">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, ease: EASE }}
        className="max-w-[720px]"
      >
        <h2 className="text-[clamp(34px,4vw,52px)] font-bold leading-[1.05] tracking-[-0.03em]">
          We make building your app <span className="rounded-[10px] bg-[var(--lime)] px-2 text-[var(--ink)]">insanely</span> simple.
        </h2>
        <p className="mt-6 max-w-[48ch] text-[17px] font-medium leading-[1.5] text-[var(--muted)]">
          Everything that usually needs a developer happens on its own.
        </p>
      </motion.div>

      <div className="mt-20 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
        <Describe />
        <Asks />
        <Fixes />
        <Code />
        <div className="md:col-span-2">
          <Change />
        </div>
      </div>
    </section>
  );
}
