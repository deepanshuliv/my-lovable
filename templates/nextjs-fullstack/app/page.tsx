export default function Home() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#fafafa] p-8 text-[#1c1d1a] [background-image:radial-gradient(rgba(28,29,26,0.12)_1px,transparent_1px)] [background-size:18px_18px]">
      <div className="w-full max-w-md -rotate-1 rounded-[16px] border-2 border-[#1c1d1a] bg-white p-8 text-center shadow-[6px_6px_0_#1c1d1a]">
        <span className="inline-flex items-center gap-2 rounded-[6px] bg-[#1c1d1a] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[#c6fd50]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c6fd50]" />
          Workspace ready
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-tight">Your app will appear here</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#5d5e58]">
          Describe what you want in the chat. This preview updates as the code is written.
        </p>
      </div>
    </main>
  );
}
