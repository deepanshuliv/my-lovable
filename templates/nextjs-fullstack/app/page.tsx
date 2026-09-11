export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="rounded-full border border-black/10 px-3 py-1 text-xs uppercase tracking-widest opacity-60 dark:border-white/15">
        ready
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Your app starts here</h1>
      <p className="max-w-md text-sm opacity-60">
        Describe what you want to build in the chat and this preview updates as the code changes.
      </p>
    </main>
  );
}
