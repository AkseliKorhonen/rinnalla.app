import { AuthPanel } from "./auth-panel";

export default function Home() {
  return (
    <main className="flex min-h-dvh items-start justify-center overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(120,113,108,0.22),_transparent_30%),linear-gradient(180deg,_#0c0a09_0%,_#111827_100%)] px-3 py-3 text-stone-50 sm:px-6 sm:py-6 lg:px-8 lg:py-10">
      <AuthPanel />
    </main>
  );
}
