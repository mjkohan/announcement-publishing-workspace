import { AnnouncementList, RestoreBanner } from "../features/announcements";

export function App() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 px-4 py-3 md:px-6 dark:border-slate-800">
        <h1 className="text-xl font-semibold">Announcement Publishing</h1>
      </header>

      <div className="flex flex-1 flex-col md:grid md:grid-cols-[320px_minmax(0,1fr)]">
        <nav
          aria-label="Announcements"
          className="min-w-0 border-b border-slate-200 px-4 py-4 md:border-r md:border-b-0 dark:border-slate-800"
        >
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
            Announcements
          </h2>
          <AnnouncementList />
        </nav>

        <main className="min-w-0 space-y-4 px-4 py-4 md:px-6">
          <RestoreBanner />
          <h2 className="text-lg font-semibold">Details</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Select an announcement to see its details.
          </p>
        </main>
      </div>
    </div>
  );
}
