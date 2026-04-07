export default function ImprintPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans flex flex-col">
      <header className="border-b border-stone-200 bg-white shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="font-bold text-emerald-700 hover:underline">
            WerkSmart
          </a>
          <a href="/privacy" className="text-sm text-stone-600 hover:underline">
            Datenschutz
          </a>
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10">
        <h1 className="text-2xl font-black text-stone-900 mb-6">Impressum</h1>
        <div className="space-y-4 text-sm text-stone-700 leading-relaxed">
          <p>
            <span className="font-semibold text-stone-900">Name:</span> Fabian Kretschmar
          </p>
          <p>
            <span className="font-semibold text-stone-900">Adresse:</span> Siedlerstr. 1, 01665 Klipphausen
          </p>
          <p>
            <span className="font-semibold text-stone-900">E-Mail:</span>{" "}
            <a href="mailto:fabian.4422k@gmail.com" className="text-emerald-700 hover:underline">
              fabian.4422k@gmail.com
            </a>
          </p>
          <p className="pt-4 text-stone-600 border-t border-stone-200">
            Dies ist eine Testversion einer Webanwendung.
          </p>
        </div>
      </main>
      <footer className="border-t border-stone-200 bg-white py-4 text-xs text-stone-500 shrink-0">
        <div className="max-w-2xl mx-auto px-4 flex flex-wrap gap-4 justify-center">
          <a href="/imprint" className="hover:text-stone-800 hover:underline">
            Impressum
          </a>
          <a href="/privacy" className="hover:text-stone-800 hover:underline">
            Datenschutz
          </a>
        </div>
      </footer>
    </div>
  );
}
