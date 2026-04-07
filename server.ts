import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const db = new Database(process.env.DB_PATH || "werkpro.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    plan TEXT DEFAULT 'free'
  );

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER UNIQUE,
    companyName TEXT,
    legalForm TEXT,
    owner TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    taxNumber TEXT,
    vatId TEXT,
    vatRate REAL DEFAULT 19,
    isSmallBusiness BOOLEAN DEFAULT 0,
    bankName TEXT,
    iban TEXT,
    bic TEXT,
    accountHolder TEXT,
    logoUrl TEXT,
    paymentTerms INTEGER DEFAULT 14,
    discount REAL DEFAULT 0,
    offerValidity INTEGER DEFAULT 30,
    currency TEXT DEFAULT 'EUR',
    FOREIGN KEY(userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    title TEXT,
    unit TEXT,
    price REAL,
    FOREIGN KEY(userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    type TEXT, -- 'offer' or 'invoice'
    docNumber TEXT,
    customerName TEXT,
    date TEXT,
    totalNet REAL,
    totalVat REAL,
    totalGross REAL,
    items JSON,
    status TEXT DEFAULT 'draft',
    FOREIGN KEY(userId) REFERENCES users(id)
  );
`);

// Simple schema versioning for future migrations
let dbUserVersion = (db.pragma("user_version", { simple: true }) as number) || 0;
if (dbUserVersion === 0) {
  db.pragma("user_version = 1");
  dbUserVersion = 1;
}
if (dbUserVersion < 2) {
  db.prepare("DELETE FROM services WHERE userId IS NULL").run();
  db.pragma("user_version = 2");
  dbUserVersion = 2;
}
if (dbUserVersion < 3) {
  db.prepare(
    "UPDATE documents SET status = 'offen' WHERE status IS NULL OR TRIM(status) = '' OR status = 'draft'"
  ).run();
  db.pragma("user_version = 3");
  dbUserVersion = 3;
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET ist nicht gesetzt. Bitte in der .env-Datei konfigurieren.");
}

type ProfileInput = {
  companyName?: string;
  legalForm?: string;
  owner?: string;
  address?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  vatId?: string;
  vatRate?: number;
  isSmallBusiness?: boolean;
  bankName?: string;
  iban?: string;
  bic?: string;
  accountHolder?: string;
  logoUrl?: string;
  paymentTerms?: number;
  discount?: number;
  offerValidity?: number;
  currency?: string;
};

type ServiceInput = {
  title?: string;
  unit?: string;
  price?: number;
};

type DocumentItemInput = {
  title: string;
  unit: string;
  price: number;
  quantity: number;
  total: number;
};

type DocumentInput = {
  type: "offer" | "invoice";
  docNumber?: string;
  customerName: string;
  date: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  items: DocumentItemInput[];
};

function validateProfileInput(data: any): { ok: true } | { ok: false; error: string; field?: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Ungültige Profildaten." };
  }
  if (!data.companyName || typeof data.companyName !== "string") {
    return { ok: false, error: "Firmenname ist erforderlich.", field: "companyName" };
  }
  if (!data.email || typeof data.email !== "string" || !data.email.includes("@")) {
    return { ok: false, error: "Bitte eine gültige E-Mail-Adresse angeben.", field: "email" };
  }
  if (data.iban && typeof data.iban !== "string") {
    return { ok: false, error: "Ungültige IBAN.", field: "iban" };
  }
  if (data.logoUrl != null && typeof data.logoUrl === "string" && data.logoUrl.length > 12_000_000) {
    return { ok: false, error: "Logo-Daten zu groß (z. B. per Datei-Upload speichern).", field: "logoUrl" };
  }
  return { ok: true };
}

function toSqlValue(value: any) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  return value;
}

function validateServiceInput(data: any): { ok: true } | { ok: false; error: string; field?: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Ungültige Leistungsdaten." };
  }
  if (!data.title || typeof data.title !== "string") {
    return { ok: false, error: "Titel ist erforderlich.", field: "title" };
  }
  const price = Number(data.price ?? 0);
  if (Number.isNaN(price) || price < 0) {
    return { ok: false, error: "Preis muss eine nicht-negative Zahl sein.", field: "price" };
  }
  return { ok: true };
}

const DOCUMENT_STATUSES = new Set(["offen", "bezahlt", "überfällig"]);

function normalizeDocumentStatus(input: unknown): string {
  if (typeof input !== "string") return "offen";
  const s = input.trim().toLowerCase();
  if (s === "paid") return "bezahlt";
  if (DOCUMENT_STATUSES.has(s)) return s;
  return "offen";
}

function validateDocumentInput(data: any): { ok: true } | { ok: false; error: string; field?: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Ungültige Dokumentdaten." };
  }
  if (data.type !== "offer" && data.type !== "invoice") {
    return { ok: false, error: "Dokumenttyp muss 'offer' oder 'invoice' sein.", field: "type" };
  }
  if (!data.customerName) {
    return { ok: false, error: "Kundenname ist erforderlich.", field: "customerName" };
  }
  if (!data.date) {
    return { ok: false, error: "Datum ist erforderlich.", field: "date" };
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { ok: false, error: "Mindestens eine Leistung ist erforderlich.", field: "items" };
  }
  for (const item of data.items as DocumentItemInput[]) {
    if (!item.title || typeof item.title !== "string") {
      return { ok: false, error: "Jede Position benötigt eine Bezeichnung.", field: "items" };
    }
    if (item.quantity <= 0 || item.price < 0) {
      return { ok: false, error: "Menge und Preis müssen positiv sein.", field: "items" };
    }
  }
  return { ok: true };
}

const PLAN_LIMITS: Record<string, { documentsPerMonth: number }> = {
  free: { documentsPerMonth: 20 },
  pro: { documentsPerMonth: 500 },
};

function logInfo(message: string, meta: any = {}) {
  console.log(JSON.stringify({ level: "info", message, ...meta, timestamp: new Date().toISOString() }));
}

function logError(message: string, meta: any = {}) {
  console.error(JSON.stringify({ level: "error", message, ...meta, timestamp: new Date().toISOString() }));
}

const uploadsRoot = path.join(__dirname, "uploads");
const logosDir = path.join(uploadsRoot, "logos");
fs.mkdirSync(logosDir, { recursive: true });

function safeLogoExt(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".img";
}

function removeStoredLogosForUser(userId: number) {
  let files: string[];
  try {
    files = fs.readdirSync(logosDir);
  } catch {
    return;
  }
  const re = new RegExp(`^${userId}\\.[^.]+$`);
  for (const name of files) {
    if (!re.test(name)) continue;
    try {
      fs.unlinkSync(path.join(logosDir, name));
    } catch {
      /* ignore */
    }
  }
}

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, logosDir);
    },
    filename: (req, file, cb) => {
      const uid = Number((req as any).user?.id);
      if (!Number.isFinite(uid)) {
        cb(new Error("Nicht angemeldet."), "");
        return;
      }
      removeStoredLogosForUser(uid);
      cb(null, `${uid}${safeLogoExt(file.mimetype)}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.mimetype)) {
      cb(new Error("Nur Bilder (PNG, JPEG, GIF, WebP) sind erlaubt."));
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Disable ETag-based 304 responses (esp. for JSON APIs)
  app.set("etag", false);

  app.use(express.json({ limit: "12mb" }));
  app.use("/uploads", express.static(uploadsRoot));

  // Disable caching for API responses to avoid 304 with empty body
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Zu viele Versuche. Bitte versuchen Sie es später erneut." },
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Middleware to verify JWT
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: "Forbidden" });
      const id = user?.id != null ? Number(user.id) : NaN;
      if (!Number.isFinite(id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      req.user = { ...user, id };
      next();
    });
  };

  // Auth Routes
  app.post("/api/auth/signup", authLimiter, async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: "E-Mail und Passwort sind erforderlich." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Das Passwort muss mindestens 8 Zeichen lang sein." });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = db.prepare("INSERT INTO users (email, password) VALUES (?, ?)").run(email, hashedPassword);
      const userId = Number(result.lastInsertRowid);
      if (!Number.isFinite(userId)) {
        logError("Signup: invalid lastInsertRowid", { lastInsertRowid: result.lastInsertRowid });
        return res.status(500).json({ error: "Registrierung fehlgeschlagen." });
      }
      const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: "12h" });
      res.json({ token, user: { id: userId, email } });
    } catch (error: any) {
      if (error.message.includes("UNIQUE constraint failed")) {
        res.status(400).json({ error: "Diese E-Mail-Adresse ist bereits registriert." });
      } else {
        logError("Signup failed", { error: error.message });
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: "E-Mail und Passwort sind erforderlich." });
    }

    const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const userId = Number(user.id);
    const token = jwt.sign({ id: userId, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, user: { id: userId, email: user.email } });
  });

  // API Routes
  app.get("/api/billing/plan", authenticateToken, (req: any, res) => {
    const user: any = db.prepare("SELECT plan FROM users WHERE id = ?").get(req.user.id);
    const plan = user?.plan || "free";
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    res.json({ plan, limits });
  });

  app.post("/api/billing/upgrade-intent", authenticateToken, (req: any, res) => {
    if (!process.env.STRIPE_PUBLIC_KEY) {
      return res.status(501).json({ error: "Zahlungsanbieter ist noch nicht konfiguriert." });
    }
    res.json({
      message: "Stripe-Integration noch nicht fertig konfiguriert.",
    });
  });
  app.get("/api/profile", authenticateToken, (req: any, res) => {
    const profile = db.prepare("SELECT * FROM profile WHERE userId = ?").get(req.user.id);
    res.json(profile || null);
  });

  app.post("/api/profile", authenticateToken, (req: any, res) => {
    const data = req.body as ProfileInput;
    const validation = validateProfileInput(data);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, field: validation.field });
    }
    const userId = req.user.id;
    const exists = db.prepare("SELECT id FROM profile WHERE userId = ?").get(userId);
    
    // Filter out fields that shouldn't be manually set/updated
    const keys = Object.keys(data).filter(k => k !== 'id' && k !== 'userId');
    const values = keys.map(k => toSqlValue((data as any)[k]));

    try {
      if (exists) {
        const setClause = keys.map(k => `${k} = ?`).join(", ");
        db.prepare(`UPDATE profile SET ${setClause} WHERE userId = ?`).run(...values, userId);
      } else {
        const columns = [...keys, "userId"].join(", ");
        const placeholders = [...keys, "userId"].map(() => "?").join(", ");
        db.prepare(`INSERT INTO profile (${columns}) VALUES (${placeholders})`).run(...values, userId);
      }
      res.json({ success: true });
    } catch (error: any) {
      logError("Error saving profile", { error: error.message, userId });
      res.status(500).json({ error: `Fehler beim Speichern des Profils: ${error.message}` });
    }
  });

  app.post(
    "/api/profile/logo",
    authenticateToken,
    (req, res, next) => {
      logoUpload.single("logo")(req, res, (err: any) => {
        if (err) {
          return res.status(400).json({ error: err.message || "Upload fehlgeschlagen." });
        }
        next();
      });
    },
    (req: any, res) => {
      const userId = req.user.id;
      if (!req.file) {
        return res.status(400).json({ error: "Keine Datei. Bitte ein Bild wählen (Feldname: logo)." });
      }
      const row = db.prepare("SELECT id FROM profile WHERE userId = ?").get(userId);
      if (!row) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
        return res.status(400).json({
          error: "Kein Profil gefunden. Bitte Stammdaten unter Einstellungen einmal speichern.",
        });
      }
      const logoUrl = `/uploads/logos/${req.file.filename}`;
      db.prepare("UPDATE profile SET logoUrl = ? WHERE userId = ?").run(logoUrl, userId);
      res.json({ logoUrl });
    }
  );

  app.delete("/api/profile/logo", authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    removeStoredLogosForUser(userId);
    db.prepare("UPDATE profile SET logoUrl = NULL WHERE userId = ?").run(userId);
    res.json({ success: true });
  });

  app.get("/api/services", authenticateToken, (req: any, res) => {
    const services = db.prepare("SELECT * FROM services WHERE userId = ?").all(req.user.id);
    res.json(services);
  });

  app.post("/api/services", authenticateToken, (req: any, res) => {
    const validation = validateServiceInput(req.body as ServiceInput);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, field: validation.field });
    }
    const { title, unit, price } = req.body as ServiceInput;
    const userId = req.user.id;
    logInfo("Saving new service", { userId });
    
    if (!title) return res.status(400).json({ error: "Titel ist erforderlich" });
    
    try {
      const stmt = db.prepare("INSERT INTO services (userId, title, unit, price) VALUES (?, ?, ?, ?)");
      stmt.run(userId, title, unit || "Std", price || 0);
      res.json({ success: true });
    } catch (error: any) {
      logError("Error saving service", { error: error.message, userId });
      res.status(500).json({ error: `Fehler beim Speichern: ${error.message}` });
    }
  });

  app.put("/api/services/:id", authenticateToken, (req: any, res) => {
    const { id } = req.params;
    const validation = validateServiceInput(req.body as ServiceInput);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, field: validation.field });
    }
    const { title, unit, price } = req.body as ServiceInput;
    const userId = req.user.id;
    logInfo("Updating service", { id, userId });
    
    try {
      const stmt = db.prepare("UPDATE services SET title = ?, unit = ?, price = ? WHERE id = ? AND userId = ?");
      const result = stmt.run(title, unit || "Std", price || 0, id, userId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Leistung nicht gefunden oder keine Berechtigung" });
      }
      res.json({ success: true });
    } catch (error: any) {
      logError("Error updating service", { error: error.message, id, userId });
      res.status(500).json({ error: `Fehler beim Aktualisieren: ${error.message}` });
    }
  });

  app.delete("/api/services/:id", authenticateToken, (req: any, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM services WHERE id = ? AND userId = ?").run(id, req.user.id);
    res.json({ success: true });
  });

  app.get("/api/documents", authenticateToken, (req: any, res) => {
    const docs = db.prepare("SELECT * FROM documents WHERE userId = ? ORDER BY id DESC").all(req.user.id);
    res.json(docs.map(d => ({ ...d, items: JSON.parse(d.items as string) })));
  });

  app.post("/api/documents", authenticateToken, (req: any, res) => {
    const validation = validateDocumentInput(req.body as DocumentInput);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, field: validation.field });
    }
    const { type, docNumber, customerName, date, totalNet, totalVat, totalGross, items } = req.body as DocumentInput;

    const userRow: any = db.prepare("SELECT plan FROM users WHERE id = ?").get(req.user.id);
    const plan = userRow?.plan || "free";
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const monthStart = new Date(date);
    monthStart.setDate(1);
    const monthStartIso = monthStart.toISOString();
    const docsThisMonth: any[] = db
      .prepare("SELECT id FROM documents WHERE userId = ? AND date >= ?")
      .all(req.user.id, monthStartIso);
    if (docsThisMonth.length >= limits.documentsPerMonth) {
      return res.status(403).json({
        error: "Dokumentenlimit für diesen Monat erreicht. Bitte Tarif upgraden.",
        field: "plan",
      });
    }

    const status = normalizeDocumentStatus((req.body as { status?: unknown }).status);

    db.prepare(`
      INSERT INTO documents (userId, type, docNumber, customerName, date, totalNet, totalVat, totalGross, items, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      type,
      docNumber,
      customerName,
      date,
      totalNet,
      totalVat,
      totalGross,
      JSON.stringify(items),
      status
    );
    res.json({ success: true });
  });

  app.patch("/api/documents/:id", authenticateToken, (req: any, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Ungültige Dokument-ID." });
    }
    const raw = (req.body as { status?: unknown })?.status;
    if (typeof raw !== "string") {
      return res.status(400).json({ error: "Status fehlt." });
    }
    const status = raw.trim().toLowerCase();
    if (!DOCUMENT_STATUSES.has(status)) {
      return res.status(400).json({ error: "Status muss offen, bezahlt oder überfällig sein." });
    }
    const result = db
      .prepare("UPDATE documents SET status = ? WHERE id = ? AND userId = ?")
      .run(status as string, id, req.user.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Dokument nicht gefunden oder keine Berechtigung." });
    }
    res.json({ success: true, status });
  });

  app.delete("/api/documents/:id", authenticateToken, (req: any, res) => {
    const { id } = req.params;
    const result = db.prepare("DELETE FROM documents WHERE id = ? AND userId = ?").run(id, req.user.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Dokument nicht gefunden oder keine Berechtigung." });
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
