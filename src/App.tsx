import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ChangeEvent,
} from "react";
import { flushSync } from "react-dom";
import { 
  Plus, 
  FileText, 
  Settings, 
  Save, 
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
  X,
  Printer,
  Download,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

import { Profile, Service, Document, DocumentItem } from "./types";
import { DocumentPdfViewer } from "./pdf/DocumentPdfViewer";
import { downloadWerkPdfDocument, printWerkPdfDocument } from "./pdf/downloadWerkPdf";
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

const LOGO_SIZE_DEFAULT = 100;
const LOGO_SIZE_MIN = 20;
const LOGO_SIZE_MAX = 100;

function clampLogoSize(value: unknown, fallback = LOGO_SIZE_DEFAULT): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(parsed)));
}

/** Zeilensumme für Live-Anzeige (Menge × Einzelpreis), unabhängig von gespeichertem item.total. */
function lineItemLineTotal(item: DocumentItem): number {
  return roundMoney((Number(item.quantity) || 0) * (Number(item.price) || 0));
}

function normalizeItemForTotals(item: DocumentItem): DocumentItem {
  return {
    ...item,
    total: lineItemLineTotal(item),
  };
}

function newDraftRowKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Position im Entwurf ersetzen, ohne Zeilen-Objekte zu mutieren (verlässliche Re-Renders). */
function mapNewDocItemsAt(
  prev: Partial<Document>,
  index: number,
  updater: (row: DocumentItem) => DocumentItem
): Partial<Document> {
  const list = prev.items || [];
  if (index < 0 || index >= list.length) return prev;
  const nextItems = list.map((row, i) => (i === index ? updater(row) : row));
  return { ...prev, items: nextItems };
}

function stripDraftRowKey(item: DocumentItem): DocumentItem {
  const next = { ...item };
  delete next.draftRowKey;
  return next;
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
    const normalizedItem: DocumentItem = {
      title: String(it?.title ?? ""),
      unit: String(it?.unit ?? "Std"),
      price: Number.isFinite(price) ? price : 0,
      quantity: Number.isFinite(qty) ? qty : 0,
      total: Number.isFinite(total) ? total : 0,
    };
    return normalizeItemForTotals(normalizedItem);
  });
  const totalNet = Number(row?.totalNet);
  const totalVat = Number(row?.totalVat);
  const totalGross = Number(row?.totalGross);
  const logoSizeOverrideRaw = row?.logoSizeOverride;
  const logoSizeOverride =
    logoSizeOverrideRaw === null
      ? null
      : Number.isFinite(Number(logoSizeOverrideRaw))
        ? clampLogoSize(logoSizeOverrideRaw)
        : undefined;
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
    status:
      row?.type === "invoice" && row?.status ? String(row.status) : undefined,
    logoSizeOverride,
  };
}

function normalizeProfileRow(row: any): Profile | null {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    companyName: String(row.companyName ?? ""),
    legalForm: String(row.legalForm ?? ""),
    owner: String(row.owner ?? ""),
    address: String(row.address ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    taxNumber: String(row.taxNumber ?? ""),
    vatId: row.vatId ? String(row.vatId) : undefined,
    vatRate: Number.isFinite(Number(row.vatRate)) ? Number(row.vatRate) : 19,
    isSmallBusiness: Boolean(row.isSmallBusiness),
    bankName: String(row.bankName ?? ""),
    iban: String(row.iban ?? ""),
    bic: String(row.bic ?? ""),
    accountHolder: String(row.accountHolder ?? ""),
    logoUrl: row.logoUrl ? String(row.logoUrl) : "",
    logoSize: clampLogoSize(row.logoSize),
    paymentTerms: Number.isFinite(Number(row.paymentTerms)) ? Number(row.paymentTerms) : 14,
    discount: Number.isFinite(Number(row.discount)) ? Number(row.discount) : 0,
    offerValidity: Number.isFinite(Number(row.offerValidity)) ? Number(row.offerValidity) : 30,
    currency: String(row.currency ?? "EUR"),
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
  const items = (newDoc.items ?? []).map(normalizeItemForTotals);
  const totalNet = roundMoney(items.reduce((sum, item) => sum + lineItemLineTotal(item), 0));
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
    logoSizeOverride:
      newDoc.logoSizeOverride === null || newDoc.logoSizeOverride === undefined
        ? undefined
        : clampLogoSize(newDoc.logoSizeOverride),
  };
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
  const buildId =
    String(import.meta.env.VITE_APP_BUILD_ID ?? import.meta.env.VITE_COMMIT_SHA ?? "local").trim() ||
    "local";
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

  const [openDocument, setOpenDocument] = useState<Document | null>(null);
  const [pdfActionBusy, setPdfActionBusy] = useState(false);

  const draftPreviewDocument = useMemo(() => buildDraftDocument(newDoc, profile), [newDoc, profile]);

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
        const profileRaw = loadJson<Profile | null>(STORAGE_KEYS.profile, null);
        const serviceRaw = loadJson<any[]>(STORAGE_KEYS.services, []);
        const documentRaw = loadJson<any[]>(STORAGE_KEYS.documents, []);
        const serviceList = Array.isArray(serviceRaw) ? serviceRaw.map(normalizeServiceRow) : [];
        const documentList = Array.isArray(documentRaw)
          ? documentRaw.map(normalizeDocumentRow)
          : [];
        const profile = normalizeProfileRow(profileRaw);

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
    const normalized = normalizeProfileRow(data);
    if (!normalized) return;
    saveJson(STORAGE_KEYS.profile, normalized);
    setProfile(normalized);
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
      draftRowKey: newDraftRowKey(),
    };
    setNewDoc((prev) => ({ ...prev, items: [...(prev.items || []), newItem] }));
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
    const normalizedItems = (newDoc.items || []).map(normalizeItemForTotals).map(stripDraftRowKey);
    const totalNet = roundMoney(normalizedItems.reduce((sum, item) => sum + lineItemLineTotal(item), 0));
    const vatRate = profile?.vatRate || 19;
    const totalVat = profile?.isSmallBusiness ? 0 : roundMoney((totalNet * vatRate) / 100);
    const totalGross = roundMoney(totalNet + totalVat);

    const docData = {
      ...newDoc,
      items: normalizedItems,
      totalNet,
      totalVat,
      totalGross,
      docNumber: `${newDoc.type === "offer" ? "ANG" : "RE"}-${Date.now()}`,
      ...(newDoc.type === "invoice" ? { status: "offen" as const } : {}),
    };

    const current = loadJson<Document[]>(STORAGE_KEYS.documents, []);
    const nextDoc: Document = {
      ...(docData as Document),
      id: Date.now(),
      logoSizeOverride:
        docData.logoSizeOverride === null || docData.logoSizeOverride === undefined
          ? undefined
          : clampLogoSize(docData.logoSizeOverride),
    };
    const next = [nextDoc, ...current];
    saveJson(STORAGE_KEYS.documents, next);
    setDocuments(next.map(normalizeDocumentRow));
    setView("dashboard");
    resetDocumentDraft();
  };

  const handleDownloadDraftPdf = async () => {
    if (pdfActionBusy) return;
    setPdfActionBusy(true);
    try {
      await downloadWerkPdfDocument(draftPreviewDocument, profile, draftPreviewDocument.docNumber);
    } catch (e) {
      console.error(e);
      alert("PDF konnte nicht erzeugt werden. Bitte versuchen Sie es erneut.");
    } finally {
      setPdfActionBusy(false);
    }
  };

  const handlePrintDraftPdf = async () => {
    if (pdfActionBusy) return;
    setPdfActionBusy(true);
    try {
      await printWerkPdfDocument(draftPreviewDocument, profile);
    } catch (e) {
      console.error(e);
      alert("Drucken ist fehlgeschlagen. Bitte PDF herunterladen und aus dem Viewer drucken.");
    } finally {
      setPdfActionBusy(false);
    }
  };

  const handleDownloadOpenDocumentPdf = async () => {
    if (!openDocument || pdfActionBusy) return;
    setPdfActionBusy(true);
    try {
      await downloadWerkPdfDocument(openDocument, profile, openDocument.docNumber);
    } catch (e) {
      console.error(e);
      alert("PDF konnte nicht erzeugt werden. Bitte versuchen Sie es erneut.");
    } finally {
      setPdfActionBusy(false);
    }
  };

  const handlePrintOpenDocumentPdf = async () => {
    if (!openDocument || pdfActionBusy) return;
    setPdfActionBusy(true);
    try {
      await printWerkPdfDocument(openDocument, profile);
    } catch (e) {
      console.error(e);
      alert("Drucken ist fehlgeschlagen. Bitte PDF herunterladen und aus dem Viewer drucken.");
    } finally {
      setPdfActionBusy(false);
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
    <div className="app-shell min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-emerald-100 flex flex-col">
      {saveFeedback && (
        <div className="fixed top-4 right-4 z-[120] bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl shadow-emerald-200 flex items-center gap-2 text-sm font-bold print:hidden">
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
                            <td className="px-6 py-4 text-stone-400 text-sm" onClick={(e) => e.stopPropagation()}>
                              {doc.type === "invoice" && doc.id != null ? (
                                <select
                                  value={displayDocumentStatus(doc)}
                                  onChange={(e) => {
                                    const v = e.target.value as DocStatus;
                                    void handleDocumentStatusChange(doc.id!, v);
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
                              ) : (
                                "—"
                              )}
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
              <div className="create-doc-print-chrome flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 print:hidden">
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

              <div className="create-doc-print-chrome flex items-center justify-between mb-12 relative print:hidden">
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

              <div className="bg-white rounded-3xl border border-stone-200 shadow-xl p-8 min-h-[400px] print:border-0 print:shadow-none print:p-0 print:rounded-none print:min-h-0 print:bg-white">
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
                              draftRowKey: newDraftRowKey(),
                            };
                            setNewDoc((prev) => ({ ...prev, items: [...(prev.items || []), newItem] }));
                          }}
                          className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> Eigene Leistung
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {newDoc.items?.map((item, idx) => {
                        const applyQuantityRaw = (raw: string) => {
                          setNewDoc((prev) =>
                            mapNewDocItemsAt(prev, idx, (row) => {
                              const q = raw === "" ? 0 : parseFloat(raw.replace(",", "."));
                              const nextQ = Number.isFinite(q) ? q : row.quantity;
                              return normalizeItemForTotals({ ...row, quantity: nextQ });
                            })
                          );
                        };
                        const applyPriceRaw = (raw: string) => {
                          setNewDoc((prev) =>
                            mapNewDocItemsAt(prev, idx, (row) => {
                              const p = raw === "" ? 0 : parseFloat(raw.replace(",", "."));
                              const nextP = Number.isFinite(p) ? p : row.price;
                              return normalizeItemForTotals({ ...row, price: nextP });
                            })
                          );
                        };
                        return (
                        <div
                          key={item.draftRowKey ?? `row-${idx}`}
                          className="p-4 rounded-2xl bg-stone-50 border border-stone-100 grid grid-cols-12 gap-4 items-end group"
                        >
                          <div className="col-span-12 sm:col-span-4">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Bezeichnung</label>
                            <input 
                              type="text" value={item.title}
                              onChange={(e) => {
                                const title = e.target.value;
                                setNewDoc((prev) =>
                                  mapNewDocItemsAt(prev, idx, (row) => ({ ...row, title }))
                                );
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
                              onChange={(e) => applyQuantityRaw(e.target.value)}
                              onInput={(e) => applyQuantityRaw(e.currentTarget.value)}
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
                                const unit = e.target.value;
                                setNewDoc((prev) =>
                                  mapNewDocItemsAt(prev, idx, (row) => ({ ...row, unit }))
                                );
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
                              step="0.01"
                              min="0"
                              value={item.price === 0 ? "" : item.price}
                              placeholder="0"
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => applyPriceRaw(e.target.value)}
                              onInput={(e) => applyPriceRaw(e.currentTarget.value)}
                              className="w-full bg-white border border-stone-300 rounded-lg px-2 py-2 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-all outline-none font-semibold tabular-nums"
                            />
                          </div>
                          <div className="col-span-3 sm:col-span-2 text-right">
                            <label className="text-[10px] font-bold text-stone-400 uppercase">Gesamt</label>
                            <p className="font-bold text-emerald-700 tabular-nums">
                              {lineItemLineTotal(item).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                            </p>
                          </div>
                          <div className="col-span-12 sm:col-span-1 flex justify-end">
                            <button 
                              onClick={() => {
                                setNewDoc((prev) => ({
                                  ...prev,
                                  items: (prev.items || []).filter((_, i) => i !== idx),
                                }));
                              }}
                              className="p-2 text-stone-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                        );
                      })}
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
                    <p className="text-sm text-stone-500 print:hidden">
                      Die Vorschau zeigt dasselbe PDF wie der Download. Bei vielen Positionen geht die Tabelle auf
                      weiteren Seiten weiter; Briefkopf und Titel erscheinen nur auf der ersten Seite.
                    </p>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4 print:hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-bold text-stone-900">Logo im Dokument</p>
                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500/25"
                            checked={newDoc.logoSizeOverride != null}
                            onChange={(e) =>
                              setNewDoc((prev) => ({
                                ...prev,
                                logoSizeOverride: e.target.checked
                                  ? clampLogoSize(prev.logoSizeOverride, profile?.logoSize ?? LOGO_SIZE_DEFAULT)
                                  : null,
                              }))
                            }
                          />
                          Eigene Logo-Groesse fuer dieses Dokument
                        </label>
                      </div>
                      {newDoc.logoSizeOverride != null ? (
                        <LogoSizeControl
                          value={newDoc.logoSizeOverride}
                          onChange={(next) =>
                            setNewDoc((prev) => ({
                              ...prev,
                              logoSizeOverride: next,
                            }))
                          }
                          className="mt-4"
                        />
                      ) : (
                        <p className="mt-3 text-xs text-stone-500">
                          Verwendet Profilwert: {clampLogoSize(profile?.logoSize, LOGO_SIZE_DEFAULT)}%
                        </p>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-inner print:border-0 print:shadow-none print:bg-white print:overflow-visible">
                      <div className="h-[min(72vh,780px)] min-h-[420px] w-full bg-stone-100 print:hidden">
                        <DocumentPdfViewer doc={draftPreviewDocument} profile={profile} className="h-full w-full min-h-0" />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 justify-center pt-8 print:hidden">
                      <button onClick={() => setCurrentStep(3)} className="px-6 py-3 font-bold text-stone-500 hover:text-stone-900 transition-colors">Zurück</button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadDraftPdf()}
                        disabled={pdfActionBusy}
                        className="bg-stone-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-stone-800 transition-colors disabled:opacity-60"
                        title="PDF-Datei herunterladen"
                      >
                        <Download className="w-5 h-5" />{" "}
                        {pdfActionBusy ? "Bitte warten…" : "PDF herunterladen"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePrintDraftPdf()}
                        disabled={pdfActionBusy}
                        className="bg-white text-stone-900 border-2 border-stone-300 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-stone-50 transition-colors disabled:opacity-60"
                        title="System-Druckdialog öffnen"
                      >
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
                        <LogoSizeControl
                          value={profile.logoSize ?? LOGO_SIZE_DEFAULT}
                          onChange={(next) => setProfile((prev) => (prev ? { ...prev, logoSize: next } : prev))}
                          className="mt-4"
                        />
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
              className="print-doc-print-host fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm print:static print:inset-auto print:z-auto print:block print:h-auto print:min-h-0 print:overflow-visible print:bg-white print:p-0"
              onClick={() => setOpenDocument(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 12 }}
                transition={{ duration: 0.2 }}
                className="print-doc-print-panel bg-stone-100 rounded-none sm:rounded-[2rem] shadow-2xl w-full max-w-5xl h-[100dvh] max-h-[100dvh] sm:h-[90vh] sm:max-h-[90vh] min-h-0 overflow-hidden border border-stone-200 flex flex-col print:h-auto print:max-h-none print:min-h-0 print:overflow-visible print:shadow-none print:border-0 print:rounded-none print:flex-none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-stone-200 bg-white shrink-0 print:hidden">
                  <div className="min-w-0 flex flex-col gap-2">
                    <h2 className="text-lg font-black text-stone-900 truncate">
                      {openDocument.type === "offer" ? "Angebot" : "Rechnung"} · {openDocument.docNumber}
                    </h2>
                    <p className="text-sm text-stone-500 truncate">{openDocument.customerName}</p>
                    {openDocument.id != null && openDocument.type === "invoice" && (
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
                      onClick={() => void handleDownloadOpenDocumentPdf()}
                      disabled={pdfActionBusy}
                      className="inline-flex items-center gap-2 bg-stone-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-stone-800 transition-colors disabled:opacity-60"
                      title="PDF-Datei herunterladen"
                    >
                      <Download className="w-4 h-4" />{" "}
                      {pdfActionBusy ? "…" : "PDF herunterladen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePrintOpenDocumentPdf()}
                      disabled={pdfActionBusy}
                      className="inline-flex items-center gap-2 bg-white text-stone-900 border-2 border-stone-300 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-stone-50 transition-colors disabled:opacity-60"
                      title="System-Druckdialog öffnen"
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
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 sm:p-6 print:flex-none print:h-auto print:min-h-0 print:overflow-visible print:p-0">
                  <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-inner print:border-0 print:shadow-none print:bg-white">
                    <div className="min-h-0 flex-1 bg-stone-100 print:hidden">
                      <DocumentPdfViewer doc={openDocument} profile={profile} className="h-full w-full min-h-0" />
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-stone-200 bg-white py-4 mt-auto shrink-0 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-stone-500">
          <Link to="/impressum" className="hover:text-stone-800 hover:underline">
            Impressum
          </Link>
          <Link to="/datenschutz" className="hover:text-stone-800 hover:underline">
            Datenschutz
          </Link>
          <span className="text-stone-400">Build: {buildId}</span>
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
    logoSize: LOGO_SIZE_DEFAULT,
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
                  <LogoSizeControl
                    value={data.logoSize ?? LOGO_SIZE_DEFAULT}
                    onChange={(next) => setData((prev) => ({ ...prev, logoSize: next }))}
                    className="mt-4"
                  />
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

function LogoSizeControl({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const safeValue = clampLogoSize(value);
  return (
    <div className={cn("rounded-2xl border border-stone-200 bg-white p-4", className)}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-bold text-stone-500 uppercase tracking-widest">Logo-Groesse (%)</span>
        <div className="w-24">
          <input
            type="number"
            min={LOGO_SIZE_MIN}
            max={LOGO_SIZE_MAX}
            value={safeValue}
            onChange={(e) => onChange(clampLogoSize(e.target.value, safeValue))}
            className="block w-full rounded-xl border border-stone-300 bg-white py-2 px-3 text-sm font-semibold focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 transition-all"
          />
        </div>
      </div>
      <input
        type="range"
        min={LOGO_SIZE_MIN}
        max={LOGO_SIZE_MAX}
        step={1}
        value={safeValue}
        onChange={(e) => onChange(clampLogoSize(e.target.value, safeValue))}
        className="mt-3 w-full accent-emerald-600"
      />
      <p className="mt-2 text-[11px] text-stone-400">
        Standard fuer Briefkopf in Angebot und Rechnung ({LOGO_SIZE_MIN}% - {LOGO_SIZE_MAX}%).
      </p>
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

