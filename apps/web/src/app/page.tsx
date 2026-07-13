import { AuthPanel } from "./auth-panel";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(120,113,108,0.22),_transparent_30%),linear-gradient(180deg,_#0c0a09_0%,_#111827_100%)] px-4 py-10 text-stone-50 sm:px-6">
      <AuthPanel />
    </main>
  );
}
