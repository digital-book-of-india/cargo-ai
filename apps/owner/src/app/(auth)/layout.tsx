import { Suspense } from "react";
import type { ReactNode } from "react";
import { BellRing, Clock3, ShieldCheck, Video } from "lucide-react";
import { RedirectIfAuthed } from "@/components/auth/RedirectIfAuthed";
import { Brand } from "@/components/common/Brand";
import { DemoBanner } from "@/components/common/DemoBanner";

const points = [
  { icon: Video, title: "Works with your existing CCTV", text: "No new sensors or lock hardware." },
  {
    icon: Clock3,
    title: "Honest status",
    text: "Shows offline or degraded instead of pretending to protect.",
  },
  {
    icon: BellRing,
    title: "Know about it first",
    text: "Alerts for suspicious activity near your shutter.",
  },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
        {/* form panel */}
        <main className="flex items-center justify-center bg-accent/40 p-5 sm:p-8">
          <div className="w-full max-w-lg animate-fade-up">
            <div className="mb-6 flex justify-center lg:hidden">
              <Brand />
            </div>
            <div className="rounded-2xl border bg-background p-6 shadow-card sm:p-10">
              <Suspense fallback={null}>
                <RedirectIfAuthed>{children}</RedirectIfAuthed>
              </Suspense>
            </div>
          </div>
        </main>

        {/* brand panel (desktop only, right side) */}
        <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-black/10 blur-3xl"
          />
          <div className="relative flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-bold tracking-tight">DBI Intelligence</span>
          </div>

          <div className="relative max-w-md">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">
              Keep an eye on your shutter, even when you are not there.
            </h2>
            <ul className="mt-8 space-y-5">
              {points.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-sm text-primary-foreground/80">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-primary-foreground/70">
            Alerts are conservative: a camera cannot guarantee detection of every touch.
          </p>
        </aside>
      </div>
    </div>
  );
}
