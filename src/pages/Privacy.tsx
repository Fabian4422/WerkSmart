import { Link } from "react-router-dom";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans flex flex-col">
      <header className="border-b border-stone-200 bg-white shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold text-emerald-700 hover:underline">
            WerkSmart
          </Link>
          <Link to="/impressum" className="text-sm text-stone-600 hover:underline">
            Impressum
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10">
        <h1 className="text-2xl font-black text-stone-900 mb-6">Datenschutz</h1>
        <div className="space-y-4 text-sm text-stone-700 leading-relaxed">
          <p>
            Diese Seite dient <strong className="text-stone-900">Testzwecken</strong>. Es werden nur die Daten
            verarbeitet, die für den Betrieb dieser Testversion technisch nötig sind — der Umfang ist bewusst
            gering gehalten.
          </p>
          <p>
            Im Browser kann <strong className="text-stone-900">localStorage</strong> genutzt werden, z. B. um
            ein Anmelde-Token oder lokale Einstellungen zwischen den Besuchen zu speichern. Du kannst die Daten
            in den Entwicklertools deines Browsers jederzeit einsehen und löschen.
          </p>
          <p>
            <strong className="text-stone-900">Hinweis zur Testversion:</strong> Es ist keine produktive,
            rechtsprüfende Dokumentation hinterlegt. Nach einer Registrierung können Daten zusätzlich auf dem
            Server (z. B. in einer Datenbank) gespeichert werden — nur für den Zweck dieser Testanwendung.
          </p>
          <p>
            Für eine spätere Produktivversion sind weitere Angaben (z. B. Rechtsgrundlagen, Speicherdauer,
            Auftragsverarbeitung) nötig — diese Kurzfassung ersetzt keine vollständige Datenschutzerklärung.
          </p>
        </div>
      </main>
      <footer className="border-t border-stone-200 bg-white py-4 text-xs text-stone-500 shrink-0">
        <div className="max-w-2xl mx-auto px-4 flex flex-wrap gap-4 justify-center">
          <Link to="/impressum" className="hover:text-stone-800 hover:underline">
            Impressum
          </Link>
          <Link to="/datenschutz" className="hover:text-stone-800 hover:underline">
            Datenschutz
          </Link>
        </div>
      </footer>
    </div>
  );
}
