import { RequireAuth } from "@/components/auth/RequireAuth";
import { MobileTabs, MobileTopbar } from "@/components/layout/MobileNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { SiteProvider } from "@/lib/site/SiteProvider";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <SiteProvider>
        <div className="min-h-screen bg-muted/40">
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
          >
            Skip to content
          </a>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileTopbar />
              <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10 md:pt-8">
                {children}
              </main>
            </div>
          </div>
          <MobileTabs />
        </div>
      </SiteProvider>
    </RequireAuth>
  );
}
