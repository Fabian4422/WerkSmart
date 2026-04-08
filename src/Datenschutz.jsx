import { Link } from "react-router-dom";

export default function Datenschutz() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 font-sans flex flex-col">
      <header className="border-b border-stone-800 bg-stone-900/80">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold text-emerald-400 hover:underline">
            WerkSmart
          </Link>
          <Link to="/impressum" className="text-sm text-stone-300 hover:text-white hover:underline">
            Impressum
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <h1 className="text-3xl font-black mb-6">Datenschutzerklaerung</h1>
        <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-4 text-sm leading-relaxed text-stone-300">
          <p>
            Diese Datenschutzerklaerung ist ein professioneller Platzhalter fuer ein privates Projekt und
            muss vor dem Live-Betrieb mit den konkreten Daten vervollstaendigt werden.
          </p>
          <p>
            <span className="font-semibold text-stone-100">Verantwortliche Stelle (Platzhalter):</span>
            <br />
            Fabian Kretschmar, Siedlerstr. 1, 01665 Klipphausen, fabian.4422k@gmail.com
          </p>
          <p>
            <span className="font-semibold text-stone-100">Hosting:</span>
            <br />
            Diese Anwendung wird ueber <strong>Vercel</strong> bereitgestellt. Beim Besuch koennen technisch
            notwendige Verbindungsdaten (z. B. IP-Adresse, Zeitpunkt, angeforderte Seite) serverseitig
            verarbeitet werden.
          </p>
          <p>
            <span className="font-semibold text-stone-100">localStorage:</span>
            <br />
            Die Anwendung nutzt den Browser-<strong>localStorage</strong>, um lokale Informationen wie
            Login-Status, Einstellungen sowie erfasste Daten auf deinem Geraet zu speichern.
          </p>
          <p>
            <span className="font-semibold text-stone-100">Zweck:</span> Verarbeitung nur zur Bereitstellung
            und Nutzung der Funktionen dieser Testanwendung.
          </p>
          <p className="pt-3 border-t border-stone-800">
            Betroffenenrechte (Auskunft, Berichtigung, Loeschung etc.) und Rechtsgrundlagen sind fuer den
            Produktivbetrieb projektspezifisch zu ergaenzen.
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

