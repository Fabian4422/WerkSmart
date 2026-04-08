import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type RefObject,
  type ChangeEvent,
} from "react";
import { flushSync } from "react-dom";
import { 
  Plus, 
  FileText, 
  Settings, 
  Save, 
  Download, 
  Printer, 
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Trash2, 
  Building2, 
  Euro, 
  CheckCircle2,
  Image as ImageIcon,
  ArrowLeft,
  Briefcase,
  LogOut,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

import { Profile, Service, Document, DocumentItem } from "./types";
import Auth from "./components/Auth";
import Landing from "./Landing";
import { Link } from "react-router-dom";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function roundMoney(value: number): number {
  // Kaufmännisch auf 2 Nachkommastellen runden
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** System-Druck: Browser-Kopf-/Fußzeilen lassen sich per CSS nicht abschalten. */
function printWithBrowserHint() {
  window.alert(
    'PDF: Im Druckdialog „Als PDF speichern“ (oder „Microsoft Print to PDF“) wählen.\n\nTipp: „Kopf- und Fußzeilen“ (Chrome/Edge) bzw. „Headers and Footers“ deaktivieren, damit kein Datum oder keine URL auf dem PDF erscheint.'
  );
  window.print();
}

/** Verkleinert Bilder für Base64 im Profil (Onboarding), damit das JSON-Limit nicht reißt. */
async function compressImageToDataUrl(file: File, maxEdge = 900): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    if (w > maxEdge || h > maxEdge) {
      if (w >= h) {
        h = Math.round((h * maxEdge) / w);
        w = maxEdge;
      } else {
        w = Math.round((w * maxEdge) / h);
        h = maxEdge;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nicht verfügbar");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const usePng =
      file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp";
    return usePng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    bitmap.close();
  }
}

function normalizeServiceRow(row: any): Service {
  const price = Number(row?.price);
  return {
    id: row?.id,
    title: String(row?.title ?? ""),
    unit: String(row?.unit ?? "Std"),
    price: Number.isFinite(price) ? price : 0,
  };
}

function normalizeDocumentRow(row: any): Document {
  const itemsRaw = Array.isArray(row?.items) ? row.items : [];
  const items: DocumentItem[] = itemsRaw.map((it: any) => {
    const price = Number(it?.price);
    const qty = Number(it?.quantity);
    const total = Number(it?.total);
    return {
      title: String(it?.title ?? ""),
      unit: String(it?.unit ?? "Std"),
      price: Number.isFinite(price) ? price : 0,
      quantity: Number.isFinite(qty) ? qty : 0,
      total: Number.isFinite(total) ? total : 0,
    };
  });
  const totalNet = Number(row?.totalNet);
  const totalVat = Number(row?.totalVat);
  const totalGross = Number(row?.totalGross);
  return {
    id: row?.id,
    type: row?.type === "invoice" ? "invoice" : "offer",
    docNumber: String(row?.docNumber ?? ""),
    customerName: String(row?.customerName ?? ""),
    date: String(row?.date ?? ""),
    totalNet: Number.isFinite(totalNet) ? totalNet : 0,
    totalVat: Number.isFinite(totalVat) ? totalVat : 0,
    totalGross: Number.isFinite(totalGross) ? totalGross : 0,
    items,
    status: row?.status ? String(row.status) : undefined,
  };
}

function formatDocDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "dd.MM.yyyy");
}

/** Entwurfs-Dokument für Vorschau/PDF – gleiche Summenlogik wie beim Speichern. */
function buildDraftDocument(newDoc: Partial<Document>, profile: Profile | null): Document {
  const items = newDoc.items ?? [];
  const totalNet = roundMoney(items.reduce((sum, item) => sum + (Number(item.total) || 0), 0));
  const vatRate = profile?.vatRate ?? 19;
  const totalVat = profile?.isSmallBusiness ? 0 : roundMoney((totalNet * vatRate) / 100);
  const totalGross = roundMoney(totalNet + totalVat);
  return {
    type: newDoc.type === "invoice" ? "invoice" : "offer",
    docNumber: (newDoc.docNumber && String(newDoc.docNumber).trim()) || "ENTWURF",
    customerName: String(newDoc.customerName ?? "").trim(),
    date: String(newDoc.date ?? ""),
    totalNet,
    totalVat,
    totalGross,
    items,
    status: newDoc.status,
  };
}

/** A4 @ 96dpi — identisch zu `.print-document` in `index.css` (Vorschau = Druck/PDF). */
const PRINT_PAGE_WIDTH_PX = 794;
const PRINT_PAGE_MIN_HEIGHT_PX = 1123;
const PRINT_PAGE_PADDING_PX = 45;
/** Innenbreite: A4 − linker/rechter Innenrand (nur px, kein % — feste Satzspiegel-Breite). */
const PRINT_CONTENT_WIDTH_PX = PRINT_PAGE_WIDTH_PX - 2 * PRINT_PAGE_PADDING_PX;

const PDF_CAPTURE_SCALE = 2;

/** Tailwind/Browser können `oklch(...)` liefern — html2canvas ersetzt durch berechnete Farben. */
function replaceOklchColors(clonedDoc: globalThis.Document) {
  const win = clonedDoc.defaultView;
  if (!win) return;

  const temp = clonedDoc.createElement("div");
  temp.style.position = "absolute";
  temp.style.visibility = "hidden";
  temp.style.pointerEvents = "none";
  temp.style.zIndex = "-1";

  const colorProps: string[] = [
    "background-color",
    "color",
    "border-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "outline-color",
    "text-decoration-color",
    "caret-color",
    "fill",
    "stroke",
  ];

  clonedDoc.querySelectorAll("*").forEach((node) => {
    const el = node as HTMLElement;
    const cs = win.getComputedStyle(el);

    for (const prop of colorProps) {
      const value = cs.getPropertyValue(prop).trim();
      if (!value) continue;
      if (value.includes("oklch") || value.includes("oklab")) {
        temp.style.setProperty(prop, value);
        clonedDoc.body?.appendChild(temp);
        const computedValue = win.getComputedStyle(temp).getPropertyValue(prop).trim();
        if (computedValue) {
          el.style.setProperty(prop, computedValue);
        } else {
          el.style.setProperty(prop, value);
        }
        temp.remove();
      }
    }

    const boxShadow = cs.getPropertyValue("box-shadow").trim();
    if (boxShadow && (boxShadow.includes("oklch") || boxShadow.includes("oklab"))) {
      temp.style.setProperty("box-shadow", boxShadow);
      clonedDoc.body?.appendChild(temp);
      const computedShadow = win.getComputedStyle(temp).getPropertyValue("box-shadow").trim();
      if (computedShadow) {
        el.style.setProperty("box-shadow", computedShadow);
      } else {
        el.style.setProperty("box-shadow", boxShadow);
      }
      temp.remove();
    }
  });
}

/** Berechnete Layout-Werte in den Klon spiegeln — gleiche Pixelgeometrie wie auf dem Bildschirm. */
function snapshotPrintDocumentStyles(clonedDoc: globalThis.Document) {
  const win = clonedDoc.defaultView;
  if (!win) return;
  const root = clonedDoc.querySelector(".print-document");
  if (!(root instanceof HTMLElement)) return;

  const PROPS = [
    "box-sizing",
    "display",
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "align-content",
    "align-self",
    "gap",
    "row-gap",
    "column-gap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "grid-template-columns",
    "grid-template-rows",
    "width",
    "min-width",
    "max-width",
    "height",
    "min-height",
    "max-height",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-collapse",
    "border-spacing",
    "table-layout",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "vertical-align",
    "text-transform",
    "text-decoration",
    "color",
    "background-color",
    "white-space",
    "overflow",
    "overflow-x",
    "overflow-y",
  ] as const;

  const nodes: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of nodes) {
    const cs = win.getComputedStyle(el);
    for (const prop of PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val) el.style.setProperty(prop, val);
    }
  }
}

async function waitForImagesInElement(el: HTMLElement) {
  const imgs = [...el.querySelectorAll("img")];
  await Promise.all(
    imgs.map(async (img) => {
      try {
        if (img.complete && img.naturalWidth > 0) {
          if (img.decode) await img.decode().catch(() => undefined);
          return;
        }
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        });
        if (img.decode) await img.decode().catch(() => undefined);
      } catch {
        /* ignore */
      }
    })
  );
}

/**
 * PDF aus dem versteckten `.print-document`: festes A4 (210×297 mm pro Seite), Inhalt 1:1 aus dem Canvas
 * (keine dynamische Seitenhöhe). Längere Dokumente werden oben→unten auf mehrere A4-Seiten verteilt.
 */
async function exportPrintDocumentToPdf(element: HTMLElement, filename: string) {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    throw new Error(
      "Die Druckvorlage ist noch nicht bereit oder hat keine Größe. Bitte Seite kurz warten und erneut versuchen."
    );
  }

  await document.fonts.ready.catch(() => undefined);
  await Promise.all([
    document.fonts.load("400 16px Inter").catch(() => undefined),
    document.fonts.load("600 16px Inter").catch(() => undefined),
    document.fonts.load("700 16px Inter").catch(() => undefined),
    document.fonts.load("800 24px Inter").catch(() => undefined),
    document.fonts.load("900 30px Inter").catch(() => undefined),
  ]);
  await waitForImagesInElement(element);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const canvas = await html2canvas(element, {
    scale: PDF_CAPTURE_SCALE,
    useCORS: true,
    allowTaint: false,
    foreignObjectRendering: false,
    backgroundColor: "#ffffff",
    logging: false,
    imageTimeout: 15000,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    onclone: (clonedDoc) => {
      replaceOklchColors(clonedDoc);
      snapshotPrintDocumentStyles(clonedDoc);
      const pd = clonedDoc.querySelector(".print-document") as HTMLElement | null;
      if (pd) {
        pd.style.boxShadow = "none";
        pd.style.outline = "none";
        pd.style.opacity = "1";
        pd.style.visibility = "visible";
        pd.style.width = `${PRINT_PAGE_WIDTH_PX}px`;
        pd.style.maxWidth = `${PRINT_PAGE_WIDTH_PX}px`;
        pd.style.minHeight = `${PRINT_PAGE_MIN_HEIGHT_PX}px`;
        pd.style.boxSizing = "border-box";
        pd.style.padding = `${PRINT_PAGE_PADDING_PX}px`;
        pd.style.margin = "0";
      }
    },
  });

  if (!canvas.width || !canvas.height) {
    throw new Error("PDF-Export: Das gerenderte Bild ist leer (0×0).");
  }

  const A4_W_MM = 210;
  const A4_H_MM = 297;

  const pageWidthPx = canvas.width;
  /** Eine PDF-Seite entspricht exakt A4-Seitenverhältnis: Höhe/Breite = 297/210 */
  const pageHeightPx = Math.round((pageWidthPx * A4_H_MM) / A4_W_MM);
  if (pageHeightPx <= 0) {
    throw new Error("PDF-Export: Ungültige Seitenhöhe.");
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const sliceCanvas = document.createElement("canvas");
  sliceCanvas.width = pageWidthPx;
  sliceCanvas.height = pageHeightPx;
  const sctx = sliceCanvas.getContext("2d");
  if (!sctx) {
    throw new Error("PDF-Export: Canvas-Kontext nicht verfügbar.");
  }

  let yPx = 0;
  let pageIndex = 0;
  while (yPx < canvas.height) {
    if (pageIndex > 0) {
      pdf.addPage();
    }

    const sliceSourceH = Math.min(pageHeightPx, canvas.height - yPx);

    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, pageWidthPx, pageHeightPx);
    sctx.drawImage(canvas, 0, yPx, pageWidthPx, sliceSourceH, 0, 0, pageWidthPx, sliceSourceH);

    const imgData = sliceCanvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", 0, 0, A4_W_MM, A4_H_MM);
    yPx += sliceSourceH;
    pageIndex += 1;
  }

  pdf.save(filename);
}

function DocumentPrintPreview({
  doc,
  profile,
  innerRef,
}: {
  doc: Document;
  profile: Profile | null;
  innerRef: RefObject<HTMLDivElement | null>;
}) {
  const W = PRINT_CONTENT_WIDTH_PX;
  const colPos = 40;
  const colTitle = 380;
  const colQty = 88;
  const colPrice = 98;
  const colTotal = 98;
  const colFooter = Math.floor(W / 2);

  return (
    <div ref={innerRef} className="print-document bg-white text-stone-800 max-w-none">
      <div style={{ width: W, maxWidth: W }}>
        <table className="mb-12 border-collapse" style={{ width: W, tableLayout: "fixed" }}>
          <tbody>
            <tr>
              <td className="align-top pb-0" style={{ width: W - 120, verticalAlign: "top" }}>
                <h3 className="text-2xl font-bold text-stone-900">{profile?.companyName}</h3>
                <p className="text-sm text-stone-500">{profile?.legalForm}</p>
                <div className="mt-4 text-xs text-stone-500">
                  <p className="mb-0.5">{profile?.address}</p>
                  <p>
                    {profile?.phone} | {profile?.email}
                  </p>
                </div>
              </td>
              <td className="align-top text-right" style={{ width: 120, verticalAlign: "top" }}>
                {profile?.logoUrl ? (
                  <img
                    src={profile.logoUrl}
                    alt="Logo"
                    className="inline-block align-top object-contain"
                    style={{ maxWidth: 120, height: 64 }}
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div
                    className="inline-block rounded-xl border border-stone-200 bg-stone-100 align-top text-center"
                    style={{ width: 64, height: 64, paddingTop: 16 }}
                  >
                    <ImageIcon className="inline-block h-8 w-8 text-stone-300" />
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mb-12" style={{ width: W }}>
          <p className="text-[10px] text-stone-400 underline mb-2">
            {profile?.companyName} • {profile?.address}
          </p>
          <p className="font-bold">{doc.customerName}</p>
        </div>

        <table className="mb-8 border-collapse" style={{ width: W, tableLayout: "fixed" }}>
          <tbody>
            <tr>
              <td className="align-bottom" style={{ verticalAlign: "bottom" }}>
                <h4 className="text-3xl font-black uppercase tracking-tighter text-stone-900">
                  {doc.type === "offer" ? "Angebot" : "Rechnung"}
                </h4>
                <p className="text-sm text-stone-500">Nr. {doc.docNumber || "—"}</p>
              </td>
              <td className="text-right text-sm align-bottom" style={{ verticalAlign: "bottom", width: 160 }}>
                <p className="text-stone-400 uppercase text-[10px] font-bold">Datum</p>
                <p className="font-bold">{formatDocDate(doc.date || "")}</p>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mb-12 border-collapse" style={{ width: W, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: colPos }} />
            <col style={{ width: colTitle }} />
            <col style={{ width: colQty }} />
            <col style={{ width: colPrice }} />
            <col style={{ width: colTotal }} />
          </colgroup>
          <thead>
            <tr className="border-b-2 border-stone-900 text-left text-[10px] font-bold uppercase tracking-widest text-stone-400">
              <th className="py-2">Pos.</th>
              <th className="py-2">Leistung</th>
              <th className="py-2 text-right">Menge</th>
              <th className="py-2 text-right">E-Preis</th>
              <th className="py-2 text-right">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {(doc.items || []).map((item, i) => (
              <tr key={i} className="border-b border-stone-100 text-sm">
                <td className="py-4 text-stone-400 align-top">{i + 1}</td>
                <td className="py-4 font-semibold align-top">{item.title}</td>
                <td className="py-4 text-right align-top tabular-nums">
                  {item.quantity} {item.unit}
                </td>
                <td className="py-4 text-right tabular-nums align-top">
                  {item.price.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </td>
                <td className="py-4 text-right font-bold tabular-nums align-top">
                  {item.total.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-stone-100 pt-8" style={{ width: 300, marginLeft: "auto" }}>
          <table className="border-collapse" style={{ width: 300, tableLayout: "fixed" }}>
            <tbody>
              <tr>
                <td className="text-sm text-stone-500 py-1 align-top" style={{ verticalAlign: "top" }}>
                  Netto
                </td>
                <td className="text-sm font-semibold tabular-nums text-right py-1 align-top" style={{ verticalAlign: "top" }}>
                  {doc.totalNet.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </td>
              </tr>
              {!profile?.isSmallBusiness && (
                <tr>
                  <td className="text-sm text-stone-500 py-1 align-top" style={{ verticalAlign: "top" }}>
                    MwSt ({profile?.vatRate}%)
                  </td>
                  <td className="text-sm font-semibold tabular-nums text-right py-1 align-top" style={{ verticalAlign: "top" }}>
                    {doc.totalVat.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                  </td>
                </tr>
              )}
              <tr className="border-t-2 border-stone-900">
                <td className="text-xl font-black pt-2 pb-1 align-bottom" style={{ verticalAlign: "bottom" }}>
                  Gesamt
                </td>
                <td className="text-xl font-black pt-2 pb-1 text-right tabular-nums align-bottom" style={{ verticalAlign: "bottom" }}>
                  {doc.totalGross.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <table className="mt-12 border-collapse border-t border-stone-100" style={{ width: W, tableLayout: "fixed" }}>
          <tbody>
            <tr>
              <td className="align-top text-[10px] text-stone-400 pt-8 align-top" style={{ width: colFooter, verticalAlign: "top", paddingTop: 32 }}>
                <p className="font-bold text-stone-600 uppercase mb-1">Bankverbindung</p>
                <p>{profile?.bankName}</p>
                <p>IBAN: {profile?.iban}</p>
                <p>BIC: {profile?.bic}</p>
              </td>
              <td className="align-top text-[10px] text-stone-400 text-right pt-8 align-top" style={{ width: W - colFooter, verticalAlign: "top", paddingTop: 32 }}>
                <p className="font-bold text-stone-600 uppercase mb-1">Steuerdaten</p>
                <p>Steuernummer: {profile?.taxNumber}</p>
                {profile?.vatId && <p>USt-ID: {profile.vatId}</p>}
                {profile?.isSmallBusiness && (
                  <p className="italic mt-1">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

type View = "onboarding" | "dashboard" | "create-doc" | "settings" | "services";

type DocStatus = "bezahlt" | "offen" | "überfällig";

type DocListQuery = {
  type: "all" | "offer" | "invoice";
  customer: string;
  amountMin: string;
  amountMax: string;
  dateFrom: string;
  dateTo: string;
  sortKey: "date" | "amount" | "customer";
  sortDir: "desc" | "asc";
};

const DEFAULT_DOC_LIST_QUERY: DocListQuery = {
  type: "all",
  customer: "",
  amountMin: "",
  amountMax: "",
  dateFrom: "",
  dateTo: "",
  sortKey: "date",
  sortDir: "desc",
};

const STORAGE_KEYS = {
  profile: "werksmart-profile",
  services: "werksmart-services",
  documents: "werksmart-documents",
} as const;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Anzeige-Status aus gespeichertem Profil-Feld `status` (manuell gesetzt). */
function displayDocumentStatus(doc: Document): DocStatus {
  const raw = (doc.status || "").trim().toLowerCase();
  if (raw === "bezahlt" || raw === "paid") return "bezahlt";
  if (raw === "überfällig" || raw === "ueberfaellig" || raw === "uberfaellig") return "überfällig";
  return "offen";
}

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(
    () => !!localStorage.getItem("werkpro-token") || localStorage.getItem("isLoggedIn") === "true"
  );
  const [token, setToken] = useState<string | null>(() => {
    const storedToken = localStorage.getItem("werkpro-token");
    if (storedToken) return storedToken;
    if (localStorage.getItem("isLoggedIn") === "true") return "local-auth-token";
    return null;
  });
  const [user, setUser] = useState<any>(() => {
    try {
      const raw = localStorage.getItem("werkpro-user");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  const [preAuthView, setPreAuthView] = useState<"landing" | "auth">("landing");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // Service Modal State
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Partial<Service> | null>(null);

  // Document Creation State
  const [newDoc, setNewDoc] = useState<Partial<Document>>({
    date: format(new Date(), "yyyy-MM-dd"),
    items: [],
  });
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [currentStep, setCurrentStep] = useState(1);

  const previewRef = useRef<HTMLDivElement>(null);
  const documentDetailPreviewRef = useRef<HTMLDivElement>(null);
  /** Nur Dokument, offscreen — identisch zur Vorschau, für html2canvas-PDF ohne UI. */
  const pdfCaptureDraftRef = useRef<HTMLDivElement>(null);
  const pdfCaptureSavedRef = useRef<HTMLDivElement>(null);
  const [openDocument, setOpenDocument] = useState<Document | null>(null);

  // Dashboard: Filter-Entwurf vs. angewendete Filter (erst nach „Filter anwenden“)
  const [appliedDocQuery, setAppliedDocQuery] = useState<DocListQuery>(() => ({ ...DEFAULT_DOC_LIST_QUERY }));
  const [draftDocQuery, setDraftDocQuery] = useState<DocListQuery>(() => ({ ...DEFAULT_DOC_LIST_QUERY }));
  const [docFiltersOpen, setDocFiltersOpen] = useState(false);

  const applyDocFilters = () => {
    setAppliedDocQuery({ ...draftDocQuery });
  };

  const resetDocFilters = () => {
    setDraftDocQuery({ ...DEFAULT_DOC_LIST_QUERY });
    setAppliedDocQuery({ ...DEFAULT_DOC_LIST_QUERY });
  };

  const filteredDocuments = useMemo(() => {
    const q = appliedDocQuery.customer.trim().toLowerCase();
    const min = appliedDocQuery.amountMin.trim() === "" ? null : Number(appliedDocQuery.amountMin);
    const max = appliedDocQuery.amountMax.trim() === "" ? null : Number(appliedDocQuery.amountMax);
    const from = appliedDocQuery.dateFrom ? new Date(appliedDocQuery.dateFrom) : null;
    const to = appliedDocQuery.dateTo ? new Date(appliedDocQuery.dateTo) : null;
    if (to && !Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
    }

    const base = documents.filter((doc) => {
      if (appliedDocQuery.type !== "all" && doc.type !== appliedDocQuery.type) return false;
      if (q && !String(doc.customerName || "").toLowerCase().includes(q)) return false;
      if (min != null && Number.isFinite(min) && doc.totalGross < min) return false;
      if (max != null && Number.isFinite(max) && doc.totalGross > max) return false;
      if (from && !Number.isNaN(from.getTime())) {
        const dd = new Date(doc.date);
        if (!Number.isNaN(dd.getTime()) && dd.getTime() < from.getTime()) return false;
      }
      if (to && !Number.isNaN(to.getTime())) {
        const dd = new Date(doc.date);
        if (!Number.isNaN(dd.getTime()) && dd.getTime() > to.getTime()) return false;
      }
      return true;
    });

    const dir = appliedDocQuery.sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      if (appliedDocQuery.sortKey === "amount") return (a.totalGross - b.totalGross) * dir;
      if (appliedDocQuery.sortKey === "customer")
        return String(a.customerName).localeCompare(String(b.customerName), "de") * dir;
      const ad = new Date(a.date).getTime();
      const bd = new Date(b.date).getTime();
      return ((Number.isNaN(ad) ? 0 : ad) - (Number.isNaN(bd) ? 0 : bd)) * dir;
    });
  }, [documents, appliedDocQuery]);

  const statusBadge = (status: DocStatus) => {
    if (status === "bezahlt") return { label: "Bezahlt", cls: "bg-emerald-100 text-emerald-700" };
    if (status === "überfällig") return { label: "Überfällig", cls: "bg-red-100 text-red-700" };
    return { label: "Offen", cls: "bg-amber-100 text-amber-800" };
  };

  const handleLogout = useCallback(() => {
    localStorage.removeItem("werkpro-token");
    localStorage.removeItem("werkpro-user");
    localStorage.removeItem("isLoggedIn");
    setToken(null);
    setUser(null);
    setProfile(null);
    setServices([]);
    setDocuments([]);
    setPreAuthView("landing");
    setView("dashboard");
    setIsLoading(false);
  }, []);

  const fetchData = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) setIsLoading(true);
      try {
        const profile = loadJson<Profile | null>(STORAGE_KEYS.profile, null);
        const serviceRaw = loadJson<any[]>(STORAGE_KEYS.services, []);
        const documentRaw = loadJson<any[]>(STORAGE_KEYS.documents, []);
        const serviceList = Array.isArray(serviceRaw) ? serviceRaw.map(normalizeServiceRow) : [];
        const documentList = Array.isArray(documentRaw)
          ? documentRaw.map(normalizeDocumentRow)
          : [];

        setProfile(profile);
        setServices(serviceList);
        setDocuments(documentList);

        if (!profile) {
          setView("onboarding");
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (token) {
      void fetchData();
    } else {
      setIsLoading(false);
    }
  }, [token, fetchData]);

  useEffect(() => {
    if (!openDocument) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenDocument(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDocument]);

  const handleAuth = (newToken: string, newUser: any) => {
    if (!newToken || typeof newToken !== "string") return;
    localStorage.setItem("werkpro-token", newToken);
    localStorage.setItem("isLoggedIn", "true");
    try {
      localStorage.setItem("werkpro-user", JSON.stringify(newUser ?? null));
    } catch {
      /* ignore quota / serialization */
    }
    flushSync(() => {
      setToken(newToken);
      setUser(newUser);
      setIsLoading(true);
      setView("dashboard");
    });
  };

  const handleSaveProfile = async (data: Profile) => {
    saveJson(STORAGE_KEYS.profile, data);
    setProfile(data);
    setSaveFeedback("Gespeichert");
    window.setTimeout(() => setSaveFeedback(null), 2200);
    if (view === "onboarding") setView("dashboard");
  };

  const handleLogoFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setProfile((p) => {
        if (!p) return p;
        const next = { ...p, logoUrl: dataUrl };
        saveJson(STORAGE_KEYS.profile, next);
        return next;
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    }
  };

  const handleRemoveLogo = async () => {
    if (!profile) return;
    if (!profile.logoUrl) return;
    if (!confirm("Firmenlogo wirklich entfernen?")) return;
    const next = { ...profile, logoUrl: undefined };
    setProfile(next);
    saveJson(STORAGE_KEYS.profile, next);
  };

  const [isSavingService, setIsSavingService] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const handleSaveService = async (service: Partial<Service>) => {
    setIsSavingService(true);
    setServiceError(null);
    try {
      const current = loadJson<Service[]>(STORAGE_KEYS.services, []);
      const clean: Service = {
        id: service.id ?? Date.now(),
        title: String(service.title ?? "").trim(),
        unit: String(service.unit ?? "Std").trim() || "Std",
        price: Number(service.price ?? 0) || 0,
      };
      const next = service.id
        ? current.map((s) => (s.id === service.id ? clean : s))
        : [...current, clean];
      saveJson(STORAGE_KEYS.services, next);
      setServices(next.map(normalizeServiceRow));
      setIsServiceModalOpen(false);
      setEditingService(null);
    } catch (err) {
      console.error("Save service error:", err);
      setServiceError(err instanceof Error ? err.message : "Fehler beim Speichern der Leistung.");
    } finally {
      setIsSavingService(false);
    }
  };

  const handleDeleteService = async (id: number) => {
    if (!confirm("Möchten Sie diese Leistung wirklich löschen?")) return;
    const current = loadJson<Service[]>(STORAGE_KEYS.services, []);
    const next = current.filter((s) => s.id !== id);
    saveJson(STORAGE_KEYS.services, next);
    setServices(next.map(normalizeServiceRow));
  };

  const handleDeleteDocument = async (docId: number) => {
    if (
      !confirm(
        "Möchten Sie dieses Dokument endgültig löschen? Dies lässt sich nicht rückgängig machen."
      )
    )
      return;
    const current = loadJson<Document[]>(STORAGE_KEYS.documents, []);
    const next = current.filter((d) => d.id !== docId);
    saveJson(STORAGE_KEYS.documents, next);
    setDocuments(next.map(normalizeDocumentRow));
    setOpenDocument((d) => (d?.id === docId ? null : d));
  };

  const handleDocumentStatusChange = async (docId: number, status: DocStatus) => {
    const current = loadJson<Document[]>(STORAGE_KEYS.documents, []);
    const next = current.map((d) => (d.id === docId ? { ...d, status } : d));
    saveJson(STORAGE_KEYS.documents, next);
    setDocuments(next.map(normalizeDocumentRow));
    setOpenDocument((d) => (d?.id === docId ? { ...d, status } : d));
  };

  const resetDocumentDraft = () => {
    setNewDoc({ date: format(new Date(), "yyyy-MM-dd"), items: [] });
    setSelectedServiceId("");
    setCurrentStep(1);
  };

  const handleDiscardDocumentDraft = () => {
    if (!confirm("Aktuellen Dokument-Entwurf wirklich verwerfen?")) return;
    resetDocumentDraft();
    setView("dashboard");
  };

  const handleWizardBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
      return;
    }
    setView("dashboard");
  };

  const handleAddSelectedService = () => {
    if (!selectedServiceId) return;
    const service = services.find((s) => s.id === Number(selectedServiceId));
    if (!service) return;
    const newItem: DocumentItem = {
      title: service.title,
      unit: service.unit,
      price: service.price,
      quantity: 1,
      total: roundMoney(service.price),
      unitLocked: true,
      serviceId: service.id,
      source: "service",
    };
    setNewDoc({ ...newDoc, items: [...(newDoc.items || []), newItem] });
    setSelectedServiceId("");
  };

  const handleCreateDocument = async () => {
    if (!newDoc.type) {
      alert("Bitte zuerst den Dokumenttyp auswählen.");
      return;
    }
    if (!newDoc.customerName?.trim()) {
      alert("Bitte Kundendaten ausfüllen.");
      return;
    }
    if (!newDoc.items?.length) {
      alert("Bitte mindestens eine Leistung hinzufügen.");
      return;
    }
    const totalNet = roundMoney(newDoc.items?.reduce((sum, item) => sum + item.total, 0) || 0);
    const vatRate = profile?.vatRate || 19;
    const totalVat = profile?.isSmallBusiness ? 0 : roundMoney((totalNet * vatRate) / 100);
    const totalGross = roundMoney(totalNet + totalVat);

    const docData = {
      ...newDoc,
      totalNet,
      totalVat,
      totalGross,
      docNumber: `${newDoc.type === "offer" ? "ANG" : "RE"}-${Date.now()}`,
      status: "offen" as const,
    };

    const current = loadJson<Document[]>(STORAGE_KEYS.documents, []);
    const nextDoc: Document = {
      ...(docData as Document),
      id: Date.now(),
    };
    const next = [nextDoc, ...current];
    saveJson(STORAGE_KEYS.documents, next);
    setDocuments(next.map(normalizeDocumentRow));
    setView("dashboard");
    resetDocumentDraft();
  };

  const generatePDF = async () => {
    if (!pdfCaptureDraftRef.current) {
      alert("PDF konnte nicht erstellt werden. Bitte kurz warten und erneut versuchen.");
      return;
    }
    try {
      await exportPrintDocumentToPdf(
        pdfCaptureDraftRef.current,
        `${newDoc.docNumber || "document"}.pdf`
      );
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error ? `PDF-Export fehlgeschlagen: ${err.message}` : "PDF-Export fehlgeschlagen."
      );
    }
  };

  const generateSavedDocumentPDF = async () => {
    if (!pdfCaptureSavedRef.current || !openDocument) return;
    try {
      await exportPrintDocumentToPdf(
        pdfCaptureSavedRef.current,
        `${openDocument.docNumber || "document"}.pdf`
      );
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error ? `PDF-Export fehlgeschlagen: ${err.message}` : "PDF-Export fehlgeschlagen."
      );
    }
  };

  if (!token) {
    if (preAuthView === "landing") {
      return <Landing onLoginClick={() => setPreAuthView("auth")} />;
    }
    return <Auth onAuth={handleAuth} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-stone-500 font-medium">WerkSmart lädt...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-emerald-100 flex flex-col">
      {view === "create-doc" && currentStep === 4 && (
        <div className="pdf-capture-root" aria-hidden>
          <DocumentPrintPreview
            doc={buildDraftDocument(newDoc, profile)}
            profile={profile}
            innerRef={pdfCaptureDraftRef}
          />
        </div>
      )}
      {openDocument && (
        <div className="pdf-capture-root" aria-hidden>
          <DocumentPrintPreview doc={openDocument} profile={profile} innerRef={pdfCaptureSavedRef} />
        </div>
      )}
      {saveFeedback && (
        <div className="fixed top-4 right-4 z-[120] bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl shadow-emerald-200 flex items-center gap-2 text-sm font-bold">
          <CheckCircle2 className="w-5 h-5" />
          {saveFeedback}
        </div>
      )}
      {/* Navigation */}
      {view !== "onboarding" && (
        <nav className="bg-white border-b border-stone-200 sticky top-0 z-50 print:hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView("dashboard")}>
                <div className="bg-emerald-600 p-1.5 rounded-lg">
                  <Briefcase className="w-6 h-6 text-white" />
                </div>
                <span className="text-xl font-bold tracking-tight text-stone-900">WerkSmart</span>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setView("services")}
                  className="p-2 text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors flex items-center gap-1"
                >
                  <Briefcase className="w-5 h-5" />
                  <span className="text-sm font-semibold hidden md:block">Standardleistungen</span>
                </button>
                <button 
                  onClick={() => setView("settings")}
                  className="p-2 text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors flex items-center gap-1"
                >
                  <Settings className="w-5 h-5" />
                  <span className="text-sm font-semibold hidden md:block">Einstellungen</span>
                </button>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                  title="Abmelden"
                >
                  <LogOut className="w-5 h-5" />
                </button>
                <div className="h-8 w-px bg-stone-200 mx-2" />
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-semibold text-stone-900">{profile?.companyName}</p>
                    <p className="text-xs text-stone-500">{profile?.owner}</p>
                  </div>
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                    {profile?.companyName?.[0] || "W"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </nav>
      )}

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {view === "onboarding" && (
            <motion.div
              key="onboarding"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Onboarding onComplete={handleSaveProfile} />
            </motion.div>
          )}

          {view === "dashboard" && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-stone-900">Dashboard</h1>
                  <p className="text-stone-500 mt-1">Willkommen zurück bei WerkSmart. Verwalten Sie Ihre Dokumente.</p>
                </div>
                <button 
                  onClick={() => {
                    resetDocumentDraft();
                    setView("create-doc");
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5"
                >
                  <Plus className="w-5 h-5" />
                  Neues Dokument
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatCard title="Angebote" value={documents.filter(d => d.type === "offer").length} icon={FileText} color="blue" />
                <StatCard title="Rechnungen" value={documents.filter(d => d.type === "invoice").length} icon={CheckCircle2} color="emerald" />
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
                  <h2 className="font-bold text-stone-900">Dokumente</h2>
                  <span className="text-sm text-stone-500 tabular-nums">
                    {filteredDocuments.length}{" "}
                    {filteredDocuments.length === 1 ? "Eintrag" : "Einträge"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDocFiltersOpen((o) => !o)}
                  className="w-full px-6 py-3 flex items-center justify-between gap-3 text-left border-b border-stone-100 bg-stone-50/90 hover:bg-stone-100/90 transition-colors"
                >
                  <span className="font-semibold text-stone-800">Filter &amp; Sortierung</span>
                  <ChevronDown
                    className={cn(
                      "w-5 h-5 text-stone-500 shrink-0 transition-transform duration-200",
                      docFiltersOpen && "rotate-180"
                    )}
                  />
                </button>
                {docFiltersOpen && (
                  <div className="px-6 py-5 border-b border-stone-100 bg-white">
                    <p className="text-xs text-stone-500 mb-4">
                      Filter kombinierbar. Erst nach Klick auf <span className="font-semibold text-stone-700">Filter anwenden</span>{" "}
                      wird die Liste aktualisiert.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">
                          Dokumenttyp
                        </label>
                        <select
                          value={draftDocQuery.type}
                          onChange={(e) =>
                            setDraftDocQuery((d) => ({
                              ...d,
                              type: e.target.value as DocListQuery["type"],
                            }))
                          }
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                        >
                          <option value="all">Alle</option>
                          <option value="offer">Angebote</option>
                          <option value="invoice">Rechnungen</option>
                        </select>
                      </div>
                      <div className="md:col-span-4">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Kunde</label>
                        <input
                          value={draftDocQuery.customer}
                          onChange={(e) => setDraftDocQuery((d) => ({ ...d, customer: e.target.value }))}
                          placeholder="Name enthält…"
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">
                          Betrag min (€)
                        </label>
                        <input
                          value={draftDocQuery.amountMin}
                          onChange={(e) => setDraftDocQuery((d) => ({ ...d, amountMin: e.target.value }))}
                          inputMode="decimal"
                          placeholder="0"
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">
                          Betrag max (€)
                        </label>
                        <input
                          value={draftDocQuery.amountMax}
                          onChange={(e) => setDraftDocQuery((d) => ({ ...d, amountMax: e.target.value }))}
                          inputMode="decimal"
                          placeholder="9999"
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Datum von</label>
                        <input
                          type="date"
                          value={draftDocQuery.dateFrom}
                          onChange={(e) => setDraftDocQuery((d) => ({ ...d, dateFrom: e.target.value }))}
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Datum bis</label>
                        <input
                          type="date"
                          value={draftDocQuery.dateTo}
                          onChange={(e) => setDraftDocQuery((d) => ({ ...d, dateTo: e.target.value }))}
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                        />
                      </div>
                      <div className="md:col-span-6">
                        <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Sortierung</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            value={draftDocQuery.sortKey}
                            onChange={(e) =>
                              setDraftDocQuery((d) => ({
                                ...d,
                                sortKey: e.target.value as DocListQuery["sortKey"],
                              }))
                            }
                            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                          >
                            <option value="date">Datum</option>
                            <option value="amount">Betrag</option>
                            <option value="customer">Kunde</option>
                          </select>
                          <select
                            value={draftDocQuery.sortDir}
                            onChange={(e) =>
                              setDraftDocQuery((d) => ({
                                ...d,
                                sortDir: e.target.value as DocListQuery["sortDir"],
                              }))
                            }
                            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                          >
                            <option value="desc">Absteigend</option>
                            <option value="asc">Aufsteigend</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-6 pt-5 border-t border-stone-100">
                      <button
                        type="button"
                        onClick={applyDocFilters}
                        className="inline-flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 text-sm font-bold shadow-sm shadow-emerald-200/80 transition-colors"
                      >
                        Filter anwenden
                      </button>
                      <button
                        type="button"
                        onClick={resetDocFilters}
                        className="inline-flex items-center justify-center rounded-xl border border-stone-300 bg-white px-6 py-2.5 text-sm font-bold text-stone-700 hover:bg-stone-50 transition-colors"
                      >
                        Zurücksetzen
                      </button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Nummer</th>
                        <th className="px-6 py-4">Typ</th>
                        <th className="px-6 py-4">Kunde</th>
                        <th className="px-6 py-4">Datum</th>
                        <th className="px-6 py-4 text-right">Betrag</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right w-24">Aktion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-stone-400 italic">
                            Keine passenden Dokumente gefunden.
                          </td>
                        </tr>
                      ) : (
                        filteredDocuments.map((doc) => (
                          <tr
                            key={doc.id}
                            onClick={() => doc.id != null && setOpenDocument(doc)}
                            className="hover:bg-stone-50 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if ((e.key === "Enter" || e.key === " ") && doc.id != null) {
                                e.preventDefault();
                                setOpenDocument(doc);
                              }
                            }}
                          >
                            <td className="px-6 py-4 font-mono text-sm">{doc.docNumber}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-md text-xs font-bold uppercase",
                                doc.type === "offer" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                              )}>
                                {doc.type === "offer" ? "Angebot" : "Rechnung"}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-medium">{doc.customerName}</td>
                            <td className="px-6 py-4 text-stone-500 text-sm">{formatDocDate(doc.date)}</td>
                            <td className="px-6 py-4 text-right font-bold">{doc.totalGross.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</td>
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={displayDocumentStatus(doc)}
                                onChange={(e) => {
                                  const v = e.target.value as DocStatus;
                                  if (doc.id != null) void handleDocumentStatusChange(doc.id, v);
                                }}
                                className={cn(
                                  "min-w-[9.5rem] max-w-full rounded-lg border border-stone-200/80 text-xs font-black py-1.5 pl-2 pr-8 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                                  statusBadge(displayDocumentStatus(doc)).cls
                                )}
                                aria-label="Status ändern"
                              >
                                <option value="offen">Offen</option>
                                <option value="bezahlt">Bezahlt</option>
                                <option value="überfällig">Überfällig</option>
                              </select>
                            </td>
                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                title="Dokument löschen"
                                onClick={() => doc.id != null && void handleDeleteDocument(doc.id)}
                                className="p-2 text-stone-400 hover:text-red-600 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {view === "create-doc" && (
            <motion.div 
              key="create-doc"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleWizardBack}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-xl transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Zurück
                  </button>
                  <h1 className="text-3xl font-bold tracking-tight">Dokument erstellen</h1>
                </div>
                <button
                  onClick={handleDiscardDocumentDraft}
                  className="self-start sm:self-auto px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl border border-red-100 transition-colors"
                >
                  Dokument verwerfen
                </button>
              </div>

              <div className="flex items-center justify-between mb-12 relative">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-stone-200 -translate-y-1/2 z-0" />
                {[1, 2, 3, 4].map((step) => (
                  <div key={step} className="relative z-10 flex flex-col items-center gap-2">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300",
                      currentStep >= step ? "bg-emerald-600 text-white" : "bg-white border-2 border-stone-200 text-stone-400"
                    )}>
                      {currentStep > step ? <CheckCircle2 className="w-6 h-6" /> : step}
                    </div>
                    <span className={cn(
                      "text-xs font-bold uppercase tracking-wider",
                      currentStep >= step ? "text-emerald-700" : "text-stone-400"
                    )}>
                      {step === 1 ? "Typ" : step === 2 ? "Kunde" : step === 3 ? "Leistungen" : "Abschluss"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-3xl border border-stone-200 shadow-xl p-8 min-h-[400px]">
                {currentStep === 1 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-2xl font-bold">Was möchten Sie erstellen?</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <button 
                        onClick={() => setNewDoc({ ...newDoc, type: "offer" })}
                        className={cn(
                          "p-8 rounded-2xl border-2 text-left transition-all group",
                          newDoc.type === "offer" ? "border-emerald-500 bg-emerald-50" : "border-stone-100 hover:border-emerald-200"
                        )}
                      >
                        <FileText className="w-10 h-10 text-blue-500 mb-4 group-hover:scale-110 transition-transform" />
                        <h3 className="text-xl font-bold mb-2">Angebot</h3>
                        <p className="text-stone-500 text-sm">Erstellen Sie ein unverbindliches Angebot für Ihren Kunden.</p>
                      </button>
                      <button 
                        onClick={() => setNewDoc({ ...newDoc, type: "invoice" })}
                        className={cn(
                          "p-8 rounded-2xl border-2 text-left transition-all group",
                          newDoc.type === "invoice" ? "border-emerald-500 bg-emerald-50" : "border-stone-100 hover:border-emerald-200"
                        )}
                      >
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-4 group-hover:scale-110 transition-transform" />
                        <h3 className="text-xl font-bold mb-2">Rechnung</h3>
                        <p className="text-stone-500 text-sm">Erstellen Sie eine Rechnung für bereits erbrachte Leistungen.</p>
                      </button>
                    </div>
                    <div className="flex justify-end pt-4">
                      <button
                        disabled={!newDoc.type}
                        onClick={() => setCurrentStep(2)}
                        className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-emerald-100 disabled:opacity-50 transition-all hover:-translate-y-0.5"
                      >
                        Weiter
                      </button>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-2xl font-bold">Kundendaten</h2>
                    <div className="space-y-4">
                      <label className="block">
                        <span className="text-sm font-bold text-stone-700 uppercase tracking-wider">Kundenname / Firma</span>
                        <input 
                          type="text" 
                          value={newDoc.customerName || ""}
                          onChange={(e) => setNewDoc({ ...newDoc, customerName: e.target.value })}
                          className="mt-1 block w-full rounded-xl border border-stone-300 bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 py-3 px-4 transition-all"
                          placeholder="z.B. Max Mustermann GmbH"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-bold text-stone-700 uppercase tracking-wider">Datum</span>
                        <input 
                          type="date" 
                          value={newDoc.date}
                          onChange={(e) => setNewDoc({ ...newDoc, date: e.target.value })}
                          className="mt-1 block w-full rounded-xl border border-stone-300 bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 py-3 px-4 transition-all"
                        />
                      </label>
                    </div>
                    <div className="flex justify-between pt-8">
                      <button onClick={() => setCurrentStep(1)} className="px-6 py-3 font-bold text-stone-500 hover:text-stone-900 transition-colors">Zurück</button>
                      <button 
                        disabled={!newDoc.customerName}
                        onClick={() => setCurrentStep(3)} 
                        className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-emerald-100 disabled:opacity-50 transition-all hover:-translate-y-0.5"
                      >
                        Weiter
                      </button>
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-bold">Leistungen hinzufügen</h2>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          value={selectedServiceId}
                          onChange={(e) => setSelectedServiceId(e.target.value)}
                          className="rounded-xl border border-stone-300 bg-white text-sm font-semibold py-2.5 px-4 min-w-[260px] focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25"
                        >
                          <option value="">Standardleistung wählen...</option>
                          {services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title} ({s.price.toFixed(2)} €/{s.unit})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleAddSelectedService}
                          disabled={!selectedServiceId}
                          className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Leistung auswählen
                        </button>
                        <button
                          onClick={() => {
                            const newItem: DocumentItem = {
                              title: "Neue Leistung",
                              unit: "Std",
                              price: 0,
                              quantity: 1,
                              total: 0,
                              unitLocked: false,
                              source: "custom",
                            };
                            setNewDoc({ ...newDoc, items: [...(newDoc.items || []), newItem] });
                          }}
                          className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> Eigene Leistung
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {newDoc.items?.map((item, idx) => (
                        <div key={idx} className="p-4 rounded-2xl bg-stone-50 border border-stone-100 grid grid-cols-12 gap-4 items-end group">
                          <div className="col-span-12 sm:col-span-4">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Bezeichnung</label>
                            <input 
                              type="text" value={item.title}
                              onChange={(e) => {
                                const items = [...(newDoc.items || [])];
                                items[idx].title = e.target.value;
                                setNewDoc({ ...newDoc, items });
                              }}
                              className="w-full bg-white border border-stone-300 rounded-lg px-2 py-2 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-semibold"
                            />
                          </div>
                          <div className="col-span-3 sm:col-span-1">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Menge</label>
                            <input 
                              type="number" 
                              value={item.quantity === 0 ? "" : item.quantity}
                              placeholder="0"
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = e.target.value;
                                const items = [...(newDoc.items || [])];
                                items[idx].quantity = val === "" ? 0 : parseFloat(val);
                                items[idx].total = roundMoney(items[idx].quantity * items[idx].price);
                                setNewDoc({ ...newDoc, items });
                              }}
                              className="w-full bg-white border border-stone-300 rounded-lg px-2 py-2 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-semibold tabular-nums"
                            />
                          </div>
                          <div className="col-span-3 sm:col-span-2">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Einheit</label>
                            <select 
                              value={item.unit}
                              disabled={!!item.unitLocked}
                              onChange={(e) => {
                                if (item.unitLocked) return;
                                const items = [...(newDoc.items || [])];
                                items[idx].unit = e.target.value;
                                setNewDoc({ ...newDoc, items });
                              }}
                              className={cn(
                                "w-full bg-white border border-stone-300 rounded-lg px-2 py-2 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-semibold appearance-none",
                                item.unitLocked ? "opacity-70 cursor-not-allowed" : ""
                              )}
                            >
                              <option value="Std">Std</option>
                              <option value="Stk">Stück</option>
                              <option value="m">Meter</option>
                              <option value="m²">m²</option>
                              <option value="m³">m³</option>
                              <option value="Psch">Psch</option>
                              <option value="kg">kg</option>
                              <option value="t">t</option>
                              <option value="l">l</option>
                            </select>
                          </div>
                          <div className="col-span-3 sm:col-span-2">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Preis (€)</label>
                            <input 
                              type="number" 
                              value={item.price === 0 ? "" : item.price}
                              placeholder="0.00"
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = e.target.value;
                                const items = [...(newDoc.items || [])];
                                items[idx].price = val === "" ? 0 : parseFloat(val);
                                items[idx].total = roundMoney(items[idx].quantity * items[idx].price);
                                setNewDoc({ ...newDoc, items });
                              }}
                              className="w-full bg-white border border-stone-300 rounded-lg px-2 py-2 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-semibold tabular-nums"
                            />
                          </div>
                          <div className="col-span-3 sm:col-span-2 text-right">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Gesamt</label>
                            <p className="font-bold text-emerald-700 tabular-nums">{roundMoney(item.total).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</p>
                          </div>
                          <div className="col-span-12 sm:col-span-1 flex justify-end">
                            <button 
                              onClick={() => {
                                const items = [...(newDoc.items || [])];
                                items.splice(idx, 1);
                                setNewDoc({ ...newDoc, items });
                              }}
                              className="p-2 text-stone-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between pt-8">
                      <button onClick={() => setCurrentStep(2)} className="px-6 py-3 font-bold text-stone-500 hover:text-stone-900 transition-colors">Zurück</button>
                      <button 
                        disabled={!newDoc.items?.length}
                        onClick={() => setCurrentStep(4)} 
                        className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-emerald-100 disabled:opacity-50 transition-all hover:-translate-y-0.5"
                      >
                        Vorschau
                      </button>
                    </div>
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-2xl font-bold print:hidden">Dokument prüfen</h2>
                    
                    <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-inner bg-stone-100 p-4 sm:p-8 print:border-0 print:shadow-none print:bg-white print:p-0">
                      <div className="w-fit mx-auto shadow-2xl shadow-stone-300/60 ring-1 ring-stone-900/5 print:shadow-none print:ring-0">
                        <DocumentPrintPreview
                          doc={buildDraftDocument(newDoc, profile)}
                          profile={profile}
                          innerRef={previewRef}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 justify-center pt-8 print:hidden">
                      <button onClick={() => setCurrentStep(3)} className="px-6 py-3 font-bold text-stone-500 hover:text-stone-900 transition-colors">Zurück</button>
                      <button
                        type="button"
                        onClick={() => void generatePDF()}
                        className="bg-stone-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-stone-800 transition-colors"
                      >
                        <Download className="w-5 h-5" /> PDF laden
                      </button>
                      <button onClick={() => printWithBrowserHint()} className="bg-stone-100 text-stone-900 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-stone-200 transition-colors">
                        <Printer className="w-5 h-5" /> Drucken
                      </button>
                      <button onClick={handleCreateDocument} className="bg-emerald-600 text-white px-10 py-3 rounded-xl font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all hover:-translate-y-1">
                        Dokument speichern
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === "services" && (
            <motion.div 
              key="services"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <button onClick={() => setView("dashboard")} className="p-2 hover:bg-stone-200 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                  <h1 className="text-3xl font-bold tracking-tight">Standardleistungen</h1>
                </div>
                <button 
                  onClick={() => {
                    setEditingService({ title: "", unit: "Std", price: 0 });
                    setIsServiceModalOpen(true);
                  }}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-100"
                >
                  <Plus className="w-5 h-5" /> Neue Leistung
                </button>
              </div>

              <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider font-bold">
                      <th className="px-6 py-4">Bezeichnung</th>
                      <th className="px-6 py-4">Einheit</th>
                      <th className="px-6 py-4">Preis</th>
                      <th className="px-6 py-4 text-right">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {services.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-stone-400 italic">
                          Noch keine Standardleistungen definiert.
                        </td>
                      </tr>
                    ) : (
                      services.map((service) => (
                        <tr key={service.id} className="hover:bg-stone-50 transition-colors">
                          <td className="px-6 py-4 font-semibold">{service.title}</td>
                          <td className="px-6 py-4 text-stone-500">{service.unit}</td>
                          <td className="px-6 py-4 font-bold text-emerald-700">{service.price.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</td>
                          <td className="px-6 py-4 text-right space-x-2">
                            <button 
                              onClick={() => {
                                setEditingService(service);
                                setIsServiceModalOpen(true);
                              }}
                              className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
                            >
                              <Settings className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => handleDeleteService(service.id!)}
                              className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "settings" && profile && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto"
            >
              <div className="flex items-center gap-4 mb-8">
                <button onClick={() => setView("dashboard")} className="p-2 hover:bg-stone-200 rounded-full transition-colors">
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <h1 className="text-3xl font-bold tracking-tight">Einstellungen</h1>
              </div>

              <div className="space-y-8">
                <section className="bg-white rounded-3xl border border-stone-200 p-8">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Building2 className="w-6 h-6 text-emerald-600" /> Stammdaten
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Firmenname</span>
                      <input type="text" value={profile.companyName} onChange={e => setProfile({...profile, companyName: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Rechtsform</span>
                      <input type="text" value={profile.legalForm} onChange={e => setProfile({...profile, legalForm: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Inhaber</span>
                      <input type="text" value={profile.owner} onChange={e => setProfile({...profile, owner: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Adresse</span>
                      <input type="text" value={profile.address} onChange={e => setProfile({...profile, address: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Telefon</span>
                      <input type="text" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">E-Mail</span>
                      <input type="email" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <div className="block sm:col-span-2">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Firmenlogo</span>
                      <p className="mt-1 text-xs text-stone-500">
                        Hochladen ersetzt ein vorheriges Logo (max. 2&nbsp;MB, PNG/JPEG/GIF/WebP). Wird in Angeboten und
                        Rechnungen oben rechts angezeigt.
                      </p>
                      <div className="mt-2 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                            onChange={handleLogoFileUpload}
                            className="block w-full text-sm text-stone-600 file:mr-4 file:rounded-xl file:border-0 file:bg-stone-900 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-stone-800"
                          />
                          {profile.logoUrl ? (
                            <div className="flex items-center gap-3 shrink-0">
                              <img
                                src={profile.logoUrl}
                                alt="Logo Vorschau"
                                className="h-14 w-14 object-contain rounded-xl bg-white border border-stone-200"
                                referrerPolicy="no-referrer"
                              />
                              <button
                                type="button"
                                onClick={() => void handleRemoveLogo()}
                                className="text-sm font-bold text-red-600 hover:text-red-700 underline underline-offset-2"
                              >
                                Logo entfernen
                              </button>
                            </div>
                          ) : (
                            <div className="h-14 w-14 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-400 text-xs font-bold">
                              —
                            </div>
                          )}
                        </div>
                        <div className="mt-3">
                          <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest">
                            Oder Bild-URL (optional)
                          </label>
                          <input
                            type="text"
                            value={profile.logoUrl || ""}
                            onChange={(e) =>
                              setProfile((prev) => (prev ? { ...prev, logoUrl: e.target.value } : prev))
                            }
                            className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
                            placeholder="https://…"
                          />
                          <p className="mt-1 text-[11px] text-stone-400">
                            URL mit &quot;Speichern&quot; unten sichern. Datei-Upload wird sofort gespeichert.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="bg-white rounded-3xl border border-stone-200 p-8">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Euro className="w-6 h-6 text-amber-600" /> Finanzen & Steuern
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Steuernummer</span>
                      <input type="text" value={profile.taxNumber} onChange={e => setProfile({...profile, taxNumber: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">USt-ID</span>
                      <input type="text" value={profile.vatId} onChange={e => setProfile({...profile, vatId: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <div className="flex items-center gap-4 sm:col-span-2 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                      <input 
                        type="checkbox" checked={profile.isSmallBusiness} 
                        onChange={e => setProfile({...profile, isSmallBusiness: e.target.checked})}
                        className="w-5 h-5 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
                      />
                      <div>
                        <p className="font-bold text-amber-900">Kleinunternehmerregelung (§ 19 UStG)</p>
                        <p className="text-xs text-amber-700">Es wird keine Umsatzsteuer berechnet und ausgewiesen.</p>
                      </div>
                    </div>
                    {!profile.isSmallBusiness && (
                      <label className="block">
                        <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">MwSt-Satz (%)</span>
                        <input type="number" value={String(profile.vatRate ?? 19)} onChange={e => setProfile({...profile, vatRate: e.target.value === "" ? 0 : Number(e.target.value)})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                      </label>
                    )}
                  </div>
                </section>

                <section className="bg-white rounded-3xl border border-stone-200 p-8">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Building2 className="w-6 h-6 text-stone-700" /> Bank & Standardwerte
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Bankname</span>
                      <input type="text" value={profile.bankName} onChange={e => setProfile({...profile, bankName: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Kontoinhaber</span>
                      <input type="text" value={profile.accountHolder} onChange={e => setProfile({...profile, accountHolder: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">IBAN</span>
                      <input type="text" value={profile.iban} onChange={e => setProfile({...profile, iban: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">BIC</span>
                      <input type="text" value={profile.bic} onChange={e => setProfile({...profile, bic: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Zahlungsfrist (Tage)</span>
                      <input type="number" value={String(profile.paymentTerms ?? 14)} onChange={e => setProfile({...profile, paymentTerms: e.target.value === "" ? 0 : Number(e.target.value)})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Rabatt (%)</span>
                      <input type="number" value={String(profile.discount ?? 0)} onChange={e => setProfile({...profile, discount: e.target.value === "" ? 0 : Number(e.target.value)})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Angebot gültig (Tage)</span>
                      <input type="number" value={String(profile.offerValidity ?? 30)} onChange={e => setProfile({...profile, offerValidity: e.target.value === "" ? 0 : Number(e.target.value)})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Währung</span>
                      <input type="text" value={profile.currency} onChange={e => setProfile({...profile, currency: e.target.value})} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white py-2.5 px-4 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all" />
                    </label>
                  </div>
                </section>

                <div className="flex justify-end gap-4">
                  <button onClick={() => setView("dashboard")} className="px-8 py-3 font-bold text-stone-500 hover:text-stone-900">Zurück</button>
                  <button 
                    onClick={() => handleSaveProfile(profile)}
                    className="bg-emerald-600 text-white px-12 py-3 rounded-xl font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all"
                  >
                    Speichern
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Service Modal */}
        <AnimatePresence>
          {isServiceModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden border border-stone-200"
              >
                <div className="p-8">
                  <h2 className="text-2xl font-black tracking-tight text-stone-900 mb-6">
                    {editingService?.id ? "Leistung bearbeiten" : "Neue Leistung"}
                  </h2>
                  
                  {serviceError && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
                      {serviceError}
                    </div>
                  )}

                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-stone-400 ml-1">Bezeichnung</label>
                      <input 
                        type="text"
                        value={editingService?.title || ""}
                        onChange={(e) => setEditingService(prev => prev ? { ...prev, title: e.target.value } : { title: e.target.value, unit: "Std", price: 0 })}
                        className="w-full bg-stone-50 border-stone-200 rounded-2xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none font-medium"
                        placeholder="z.B. Fliesen verlegen"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-stone-400 ml-1">Einheit</label>
                        <select 
                          value={editingService?.unit || "Std"}
                          onChange={(e) => setEditingService(prev => prev ? { ...prev, unit: e.target.value } : { title: "", unit: e.target.value, price: 0 })}
                          className="w-full bg-stone-50 border-stone-200 rounded-2xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none font-medium"
                        >
                          <option value="Std">Std</option>
                          <option value="Stk">Stück</option>
                          <option value="m">Meter</option>
                          <option value="m²">m²</option>
                          <option value="m³">m³</option>
                          <option value="Psch">Pauschal</option>
                          <option value="kg">kg</option>
                          <option value="t">Tonne</option>
                          <option value="l">Liter</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-stone-400 ml-1">Preis (€)</label>
                        <input 
                          type="number"
                          step="0.01"
                          value={editingService?.price === 0 ? "" : editingService?.price}
                          placeholder="0.00"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingService(prev => prev ? { ...prev, price: val === "" ? 0 : parseFloat(val) } : { title: "", unit: "Std", price: val === "" ? 0 : parseFloat(val) });
                          }}
                          className="w-full bg-stone-50 border-stone-200 rounded-2xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none font-medium"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-10">
                    <button 
                      onClick={() => setIsServiceModalOpen(false)}
                      className="flex-1 py-3 rounded-2xl font-bold text-stone-500 hover:bg-stone-50 transition-all"
                    >
                      Abbrechen
                    </button>
                    <button 
                      onClick={() => {
                        if (!editingService?.title?.trim()) {
                          setServiceError("Bitte geben Sie eine Bezeichnung ein.");
                          return;
                        }
                        handleSaveService(editingService);
                      }}
                      disabled={isSavingService}
                      className="flex-1 bg-emerald-600 text-white py-3 rounded-2xl font-black shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSavingService ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Speichert...
                        </>
                      ) : "Speichern"}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {openDocument && (
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm print:bg-white print:p-0"
              onClick={() => setOpenDocument(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 12 }}
                transition={{ duration: 0.2 }}
                className="bg-stone-100 rounded-[2rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden border border-stone-200 flex flex-col print:max-h-none print:shadow-none print:border-0 print:rounded-none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-stone-200 bg-white shrink-0 print:hidden">
                  <div className="min-w-0 flex flex-col gap-2">
                    <h2 className="text-lg font-black text-stone-900 truncate">
                      {openDocument.type === "offer" ? "Angebot" : "Rechnung"} · {openDocument.docNumber}
                    </h2>
                    <p className="text-sm text-stone-500 truncate">{openDocument.customerName}</p>
                    {openDocument.id != null && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Status</span>
                        <select
                          value={displayDocumentStatus(openDocument)}
                          onChange={(e) => {
                            const v = e.target.value as DocStatus;
                            void handleDocumentStatusChange(openDocument.id!, v);
                          }}
                          className={cn(
                            "rounded-lg border border-stone-200/80 text-xs font-black py-1.5 pl-2 pr-8 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                            statusBadge(displayDocumentStatus(openDocument)).cls
                          )}
                          aria-label="Status ändern"
                        >
                          <option value="offen">Offen</option>
                          <option value="bezahlt">Bezahlt</option>
                          <option value="überfällig">Überfällig</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void generateSavedDocumentPDF()}
                      className="inline-flex items-center gap-2 bg-stone-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-stone-800 transition-colors"
                    >
                      <Download className="w-4 h-4" /> PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => printWithBrowserHint()}
                      className="inline-flex items-center gap-2 bg-stone-100 text-stone-900 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-stone-200 transition-colors"
                    >
                      <Printer className="w-4 h-4" /> Drucken
                    </button>
                    {openDocument.id != null && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteDocument(openDocument.id!)}
                        className="inline-flex items-center gap-2 bg-red-50 text-red-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-100 border border-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" /> Löschen
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenDocument(null)}
                      className="p-2.5 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-900 transition-colors"
                      aria-label="Schließen"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto p-4 sm:p-6 flex-1 print:overflow-visible print:p-0">
                  <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-inner bg-stone-100 p-4 sm:p-8 print:border-0 print:shadow-none print:bg-white">
                    <div className="w-fit mx-auto shadow-2xl shadow-stone-300/60 ring-1 ring-stone-900/5 print:shadow-none print:ring-0">
                      <DocumentPrintPreview
                        doc={openDocument}
                        profile={profile}
                        innerRef={documentDetailPreviewRef}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
      <footer className="border-t border-stone-200 bg-white py-4 mt-auto shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-stone-500">
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

function StatCard({ title, value, icon: Icon, color }: { title: string, value: string | number, icon: any, color: string }) {
  const colors = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100"
  };
  return (
    <div className={cn("p-6 rounded-2xl border flex items-center gap-4", colors[color as keyof typeof colors])}>
      <div className={cn("p-3 rounded-xl bg-white shadow-sm")}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest opacity-70">{title}</p>
        <p className="text-2xl font-black">{value}</p>
      </div>
    </div>
  );
}

function Onboarding({ onComplete }: { onComplete: (data: Profile) => void | Promise<void> }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<Profile>({
    companyName: "",
    legalForm: "Einzelunternehmen",
    owner: "",
    address: "",
    phone: "",
    email: "",
    taxNumber: "",
    vatRate: 19,
    isSmallBusiness: false,
    bankName: "",
    iban: "",
    bic: "",
    accountHolder: "",
    logoUrl: "",
    paymentTerms: 14,
    discount: 0,
    offerValidity: 30,
    currency: "EUR"
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = (currentStep: number) => {
    const newErrors: Record<string, string> = {};

    if (currentStep === 1) {
      if (!data.companyName.trim()) newErrors.companyName = "Bitte Firmenname eingeben.";
      if (!data.legalForm.trim()) newErrors.legalForm = "Bitte Rechtsform eingeben.";
      if (!data.owner.trim()) newErrors.owner = "Bitte Inhaber eingeben.";
      if (!data.address.trim()) newErrors.address = "Bitte Adresse eingeben.";
      if (!data.phone.trim()) newErrors.phone = "Bitte Telefonnummer eingeben.";
      if (!data.email.trim()) {
        newErrors.email = "Bitte E-Mail-Adresse eingeben.";
      } else if (!data.email.includes("@")) {
        newErrors.email = "Bitte eine gültige E-Mail-Adresse eingeben.";
      }
    }

    if (currentStep === 2) {
      if (!data.taxNumber.trim()) newErrors.taxNumber = "Bitte Steuernummer eingeben.";
      if (!data.isSmallBusiness) {
        const vat = Number(data.vatRate);
        if (Number.isNaN(vat) || vat <= 0) {
          newErrors.vatRate = "Bitte einen gültigen MwSt-Satz angeben.";
        }
      }
    }

    if (currentStep === 3) {
      if (!data.bankName.trim()) newErrors.bankName = "Bitte Bankname eingeben.";
      if (!data.iban.trim()) newErrors.iban = "Bitte IBAN eingeben.";
      if (!data.bic.trim()) newErrors.bic = "Bitte BIC eingeben.";
      if (!data.accountHolder.trim()) newErrors.accountHolder = "Bitte Kontoinhaber eingeben.";
    }

    if (currentStep === 4) {
      const pt = Number(data.paymentTerms);
      const ov = Number(data.offerValidity);
      if (Number.isNaN(pt) || pt <= 0) newErrors.paymentTerms = "Bitte eine gültige Zahlungsfrist angeben.";
      if (Number.isNaN(ov) || ov <= 0) newErrors.offerValidity = "Bitte eine gültige Gültigkeit angeben.";
      if (!data.currency.trim()) newErrors.currency = "Bitte Währung eingeben.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const next = () => {
    if (validateStep(step)) {
      setStep(s => s + 1);
    }
  };
  const prev = () => setStep(s => s - 1);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-12">
        <div className="inline-block bg-emerald-600 p-3 rounded-2xl mb-4 shadow-xl shadow-emerald-200">
          <Briefcase className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-black tracking-tighter text-stone-900">Willkommen bei WerkSmart</h1>
        <p className="text-stone-500 mt-2">Lassen Sie uns Ihr Unternehmen in wenigen Schritten einrichten.</p>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-stone-200 shadow-2xl p-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-stone-100">
          <motion.div 
            className="h-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold mb-8">1. Stammdaten</h2>
              <div className="grid grid-cols-1 gap-4">
                <Input label="Firmenname" value={data.companyName} onChange={v => setData({...data, companyName: v})} />
              {errors.companyName && <p className="text-xs text-red-600 ml-1">{errors.companyName}</p>}
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Rechtsform" value={data.legalForm} onChange={v => setData({...data, legalForm: v})} />
                {errors.legalForm && <p className="text-xs text-red-600 ml-1 col-span-2">{errors.legalForm}</p>}
                  <Input label="Inhaber" value={data.owner} onChange={v => setData({...data, owner: v})} />
                {errors.owner && <p className="text-xs text-red-600 ml-1 col-span-2">{errors.owner}</p>}
                </div>
                <Input label="Adresse" value={data.address} onChange={v => setData({...data, address: v})} />
              {errors.address && <p className="text-xs text-red-600 ml-1">{errors.address}</p>}
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Telefon" value={data.phone} onChange={v => setData({...data, phone: v})} />
                {errors.phone && <p className="text-xs text-red-600 ml-1 col-span-2">{errors.phone}</p>}
                  <Input label="E-Mail" type="email" value={data.email} onChange={v => setData({...data, email: v})} />
                {errors.email && <p className="text-xs text-red-600 ml-1 col-span-2">{errors.email}</p>}
                </div>
                <div className="mt-2 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-2">Firmenlogo (optional)</p>
                  <div className="flex items-center gap-4">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          const dataUrl = await compressImageToDataUrl(file);
                          setData((prev) => ({ ...prev, logoUrl: dataUrl }));
                        } catch {
                          alert("Bild konnte nicht gelesen werden. Bitte PNG oder JPEG verwenden.");
                        }
                      }}
                      className="block w-full text-sm text-stone-600 file:mr-4 file:rounded-xl file:border-0 file:bg-stone-900 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-stone-800"
                    />
                    {data.logoUrl ? (
                      <img src={data.logoUrl} alt="Logo Vorschau" className="h-12 w-12 object-contain rounded-xl bg-white border border-stone-200" />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-400 text-xs font-bold">
                        Logo
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={next} className="w-full bg-stone-900 text-white py-4 rounded-2xl font-bold mt-8 hover:bg-stone-800 transition-all">Weiter</button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold mb-8">2. Steuern & Finanzen</h2>
              <div className="grid grid-cols-1 gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Steuernummer" value={data.taxNumber} onChange={v => setData({...data, taxNumber: v})} />
                  <Input label="USt-ID (optional)" value={data.vatId || ""} onChange={v => setData({...data, vatId: v})} />
                </div>
                {errors.taxNumber && <p className="text-xs text-red-600 ml-1">{errors.taxNumber}</p>}
                <div className="flex items-center gap-4 p-4 bg-stone-50 rounded-2xl border border-stone-100">
                  <input 
                    type="checkbox" checked={data.isSmallBusiness} 
                    onChange={e => setData({...data, isSmallBusiness: e.target.checked})}
                    className="w-6 h-6 text-emerald-600 rounded-lg border-stone-300 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="font-bold">Kleinunternehmerregelung</p>
                    <p className="text-xs text-stone-500">Kein MwSt-Ausweis gemäß § 19 UStG</p>
                  </div>
                </div>
                {!data.isSmallBusiness && (
                  <Input label="MwSt-Satz (%)" type="number" value={data.vatRate.toString()} onChange={v => setData({...data, vatRate: v === "" ? 0 : parseFloat(v)})} />
                )}
                {errors.vatRate && <p className="text-xs text-red-600 ml-1">{errors.vatRate}</p>}
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={prev} className="flex-1 bg-stone-100 text-stone-900 py-4 rounded-2xl font-bold">Zurück</button>
                <button onClick={next} className="flex-[2] bg-stone-900 text-white py-4 rounded-2xl font-bold hover:bg-stone-800 transition-all">Weiter</button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div 
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold mb-8">3. Bankverbindung</h2>
              <div className="grid grid-cols-1 gap-4">
                <Input label="Bankname" value={data.bankName} onChange={v => setData({...data, bankName: v})} />
                {errors.bankName && <p className="text-xs text-red-600 ml-1">{errors.bankName}</p>}
                <Input label="IBAN" value={data.iban} onChange={v => setData({...data, iban: v})} />
                {errors.iban && <p className="text-xs text-red-600 ml-1">{errors.iban}</p>}
                <Input label="BIC" value={data.bic} onChange={v => setData({...data, bic: v})} />
                {errors.bic && <p className="text-xs text-red-600 ml-1">{errors.bic}</p>}
                <Input label="Kontoinhaber" value={data.accountHolder} onChange={v => setData({...data, accountHolder: v})} />
                {errors.accountHolder && <p className="text-xs text-red-600 ml-1">{errors.accountHolder}</p>}
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={prev} className="flex-1 bg-stone-100 text-stone-900 py-4 rounded-2xl font-bold">Zurück</button>
                <button onClick={next} className="flex-[2] bg-stone-900 text-white py-4 rounded-2xl font-bold hover:bg-stone-800 transition-all">Weiter</button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div 
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold mb-8">4. Standardeinstellungen</h2>
              <div className="grid grid-cols-1 gap-4">
                <Input label="Zahlungsfrist (Tage)" type="number" value={data.paymentTerms.toString()} onChange={v => setData({...data, paymentTerms: v === "" ? 0 : parseInt(v)})} />
                {errors.paymentTerms && <p className="text-xs text-red-600 ml-1">{errors.paymentTerms}</p>}
                <Input label="Angebot Gültigkeit (Tage)" type="number" value={data.offerValidity.toString()} onChange={v => setData({...data, offerValidity: v === "" ? 0 : parseInt(v)})} />
                {errors.offerValidity && <p className="text-xs text-red-600 ml-1">{errors.offerValidity}</p>}
                <Input label="Währung" value={data.currency} onChange={v => setData({...data, currency: v})} />
                {errors.currency && <p className="text-xs text-red-600 ml-1">{errors.currency}</p>}
              </div>
              <div className="flex gap-4 mt-8">
                <button onClick={prev} className="flex-1 bg-stone-100 text-stone-900 py-4 rounded-2xl font-bold">Zurück</button>
                <button onClick={() => onComplete(data)} className="flex-[2] bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all">Einrichtung abschließen</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string, value: string, onChange: (v: string) => void, type?: string }) {
  const displayValue = type === "number" && value === "0" ? "" : value;
  
  return (
    <label className="block">
      <span className="text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">{label}</span>
      <input 
        type={type} 
        value={displayValue} 
        placeholder={type === "number" ? "0" : ""}
        onFocus={(e) => type === "number" && e.target.select()}
        onChange={e => onChange(e.target.value)} 
        className="mt-1 block w-full rounded-2xl border border-stone-300 bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 py-3 px-4 transition-all"
      />
    </label>
  );
}

