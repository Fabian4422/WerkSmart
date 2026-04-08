import React, { useState } from "react";
import { motion } from "motion/react";
import { Briefcase, Mail, Lock, ArrowRight, UserPlus, LogIn } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Link } from "react-router-dom";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AuthProps {
  onAuth: (token: string, user: any) => void;
}

const LOCAL_USERS_KEY = "werksmart-local-users";
const LOCAL_TOKEN = "local-auth-token";

export default function Auth({ onAuth }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [legalView, setLegalView] = useState<"none" | "terms" | "privacy" | "imprint">("none");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    if (!isLogin && password.length < 8) {
      setIsLoading(false);
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        throw new Error("Bitte eine E-Mail-Adresse eingeben.");
      }

      const usersRaw = localStorage.getItem(LOCAL_USERS_KEY);
      let users: any[] = [];
      try {
        const parsed = JSON.parse(usersRaw || "[]");
        users = Array.isArray(parsed) ? parsed : [];
      } catch {
        users = [];
      }

      if (isLogin) {
        const existing = users.find(
          (u: any) => String(u?.email || "").toLowerCase() === normalizedEmail
        );
        if (!existing || existing.password !== password) {
          throw new Error("E-Mail oder Passwort ist falsch.");
        }

        localStorage.setItem("werkpro-user", JSON.stringify({ id: existing.id, email: existing.email }));
        localStorage.setItem("werkpro-token", LOCAL_TOKEN);
        localStorage.setItem("isLoggedIn", "true");
        onAuth(LOCAL_TOKEN, { id: existing.id, email: existing.email, localOnly: true });
      } else {
        const alreadyExists = users.some(
          (u: any) => String(u?.email || "").toLowerCase() === normalizedEmail
        );
        if (alreadyExists) {
          throw new Error("Diese E-Mail ist bereits registriert.");
        }

        const newUser = {
          id: Date.now(),
          email: normalizedEmail,
          password,
          createdAt: new Date().toISOString(),
        };
        const updatedUsers = [...users, newUser];
        localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(updatedUsers));
        localStorage.setItem("werkpro-user", JSON.stringify({ id: newUser.id, email: newUser.email }));
        localStorage.setItem("werkpro-token", LOCAL_TOKEN);
        localStorage.setItem("isLoggedIn", "true");
        onAuth(LOCAL_TOKEN, { id: newUser.id, email: newUser.email, localOnly: true });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4 font-sans flex-col">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="text-center mb-8">
          <div className="inline-flex bg-emerald-600 p-3 rounded-2xl mb-4 shadow-xl shadow-emerald-100">
            <Briefcase className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter text-stone-900">WerkSmart</h1>
          <p className="text-stone-500 mt-2 font-medium">Die Profilösung für Ihr Handwerk</p>
        </div>

        <div className="bg-white rounded-[2.5rem] border border-stone-200 shadow-2xl shadow-stone-200/50 p-8 sm:p-10">
          <div className="flex bg-stone-100 p-1.5 rounded-2xl mb-8">
            <button 
              onClick={() => setIsLogin(true)}
              className={cn(
                "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                isLogin ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              <LogIn className="w-4 h-4" /> Anmelden
            </button>
            <button 
              onClick={() => setIsLogin(false)}
              className={cn(
                "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                !isLogin ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              <UserPlus className="w-4 h-4" /> Registrieren
            </button>
          </div>

          <div className="mb-6 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
            {isLogin ? (
              <p>
                <span className="font-bold">Für bestehende Nutzer:</span> Bitte melden Sie sich mit Ihrer E-Mail-Adresse und Ihrem Passwort an.
              </p>
            ) : (
              <div className="space-y-1">
                <p>
                  <span className="font-bold">Für neue Nutzer:</span> Sie erstellen ein neues Konto mit E-Mail und Passwort.
                </p>
                <p className="text-xs text-stone-500">
                  Hinweis: Aktuell gibt es keine E‑Mail‑Bestätigung – das Konto ist nach der Registrierung sofort aktiv.
                </p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-stone-400 ml-1">E-Mail Adresse</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border border-stone-300 rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-medium"
                  placeholder="name@firma.de"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-stone-400 ml-1">Passwort</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                <input 
                  type="password" 
                  required
                  value={password}
                onChange={(e) => {
                  const val = e.target.value;
                  setPassword(val);
                  if (!isLogin) {
                    if (val.length > 0 && val.length < 8) {
                      setPasswordHint("Mindestens 8 Zeichen empfohlen.");
                    } else {
                      setPasswordHint("");
                    }
                  } else {
                    setPasswordHint("");
                  }
                }}
                  className="w-full bg-white border border-stone-300 rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-medium"
                  placeholder="••••••••"
                />
              </div>
            {passwordHint && (
              <p className="text-xs text-stone-500 ml-1">{passwordHint}</p>
            )}
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm font-bold border border-red-100"
              >
                {error}
              </motion.div>
            )}

            <button 
              type="submit"
              disabled={isLoading}
              className="w-full bg-stone-900 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-stone-900/10 hover:bg-stone-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isLogin ? "Anmelden" : "Konto erstellen"}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center mt-8 text-stone-400 text-sm font-medium">
          Durch die Anmeldung akzeptieren Sie unsere <br />
          <span
            className="text-stone-600 underline cursor-pointer"
            onClick={() => setLegalView("terms")}
          >
            Nutzungsbedingungen
          </span>{" "}
          &{" "}
          <span
            className="text-stone-600 underline cursor-pointer"
            onClick={() => setLegalView("privacy")}
          >
            Datenschutz
          </span>{" "}
          ·{" "}
          <span
            className="text-stone-600 underline cursor-pointer"
            onClick={() => setLegalView("imprint")}
          >
            Impressum
          </span>
        </p>

        {legalView !== "none" && (
          <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-8 space-y-4">
              <h2 className="text-2xl font-black mb-2">
                {legalView === "terms"
                  ? "Nutzungsbedingungen"
                  : legalView === "privacy"
                  ? "Datenschutzerklärung"
                  : "Impressum"}
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Diese Texte dienen als Platzhalter. Bitte ersetzen Sie sie durch rechtssicher geprüfte
                Inhalte (z.B. von einem spezialisierten Anbieter oder Ihrer Rechtsberatung), bevor Sie
                die Anwendung produktiv nutzen.
              </p>
              <button
                onClick={() => setLegalView("none")}
                className="mt-4 inline-flex px-6 py-2 rounded-2xl bg-stone-900 text-white text-sm font-bold"
              >
                Schließen
              </button>
            </div>
          </div>
        )}
      </motion.div>
      <footer className="mt-8 text-xs text-stone-500 flex items-center gap-5">
        <Link to="/impressum" className="hover:text-stone-800 hover:underline">
          Impressum
        </Link>
        <Link to="/datenschutz" className="hover:text-stone-800 hover:underline">
          Datenschutz
        </Link>
      </footer>
    </div>
  );
}
