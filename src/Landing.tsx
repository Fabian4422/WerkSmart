import React from "react";
import { Briefcase, CheckCircle2, FileText } from "lucide-react";
import { Link } from "react-router-dom";

export default function Landing({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-xl">
              <Briefcase className="w-6 h-6 text-white" />
            </div>
            <span className="font-black text-xl tracking-tight">WerkSmart</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4 text-sm font-medium text-stone-600">
            <span>Angebote &amp; Rechnungen</span>
            <span>für Handwerksbetriebe</span>
            </div>
            <button
              onClick={onLoginClick}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-bold hover:bg-stone-800 transition-colors"
            >
              Anmelden
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-4 py-12 grid gap-10 md:grid-cols-[2fr,1fr] items-center">
          <div className="space-y-6">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight">
              Angebote &amp; Rechnungen in Minuten, nicht in Stunden.
            </h1>
            <p className="text-lg text-stone-600 max-w-xl">
              WerkSmart ist deine schlanke Büro-Lösung für den Alltag im Handwerk:
              Stammdaten einmal eintragen, Leistungen hinterlegen und mit wenigen Klicks
              professionelle Dokumente erstellen.
            </p>
            <ul className="space-y-2 text-stone-700 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Steuerlich saubere Angebote und Rechnungen mit deinem Briefkopf</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Leistungskatalog einmal pflegen, beliebig oft verwenden</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>PDF mit einem Klick – bereit zum Versenden oder Ausdrucken</span>
              </li>
            </ul>
          </div>
          <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-50 p-3 rounded-2xl">
                <FileText className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">
                  Ein Blick in WerkSmart
                </p>
                <p className="font-semibold text-stone-800">
                  Angebote &amp; Rechnungen auf einen Blick
                </p>
              </div>
            </div>
            <p className="text-sm text-stone-600">
              Logge dich ein, um dein Dashboard zu sehen. Dort verwaltest du alle Dokumente,
              Leistungen und Firmendaten.
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-stone-200 bg-white text-xs text-stone-500">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center gap-4 justify-between">
          <span>© {new Date().getFullYear()} WerkSmart</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/impressum" className="hover:text-stone-800 hover:underline">
              Impressum
            </Link>
            <Link to="/datenschutz" className="hover:text-stone-800 hover:underline">
              Datenschutz
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

