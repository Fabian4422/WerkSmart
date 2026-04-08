import { Link } from "react-router-dom";

export default function Impressum() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 font-sans flex flex-col">
      <header className="border-b border-stone-800 bg-stone-900/80">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold text-emerald-400 hover:underline">
            WerkSmart
          </Link>
          <Link to="/datenschutz" className="text-sm text-stone-300 hover:text-white hover:underline">
            Datenschutz
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <h1 className="text-3xl font-black mb-6">Impressum</h1>
        <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-4 text-sm leading-relaxed text-stone-300">
          <p>
            <span className="font-semibold text-stone-100">Angaben gemaess § 5 TMG (Platzhalter):</span>
          </p>
          <p>
            Name: Fabian Kretschmar
            <br />
            Anschrift: Siedlerstr. 1, 01665 Klipphausen
            <br />
            E-Mail: fabian.4422k@gmail.com
          </p>
          <p>
            Verantwortlich fuer den Inhalt nach § 18 Abs. 2 MStV:
            <br />
            Fabian Kretschmar, Siedlerstr. 1, 01665 Klipphausen
          </p>
          <p className="pt-3 border-t border-stone-800">
            Hinweis: Dieses Impressum ist ein Platzhalter fuer ein privates Projekt und ersetzt keine
            individuelle Rechtsberatung.
          </p>
        </div>
      </main>

      <footer className="border-t border-stone-800 bg-stone-900 py-4 text-xs text-stone-400">
        <div className="max-w-3xl mx-auto px-4 flex justify-center gap-6">
          <Link to="/impressum" className="hover:text-white hover:underline">
            Impressum
          </Link>
          <Link to="/datenschutz" className="hover:text-white hover:underline">
            Datenschutz
          </Link>
        </div>
      </footer>
    </div>
  );
}

