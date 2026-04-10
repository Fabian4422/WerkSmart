import { pdf } from "@react-pdf/renderer";
import type { Document as BizDocument, Profile } from "../types";
import { WerkDocumentPdf } from "./WerkDocumentPdf";

function safeFilename(base: string): string {
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").trim();
  return cleaned || "dokument";
}

export async function downloadWerkPdfDocument(
  doc: BizDocument,
  profile: Profile | null,
  filenameBase?: string
): Promise<void> {
  const blob = await pdf(<WerkDocumentPdf doc={doc} profile={profile} />).toBlob();
  const name = safeFilename(filenameBase || doc.docNumber || "dokument") + ".pdf";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Öffnet den System-Druckdialog für dasselbe PDF wie in der Vorschau. */
export async function printWerkPdfDocument(
  doc: BizDocument,
  profile: Profile | null
): Promise<void> {
  const blob = await pdf(<WerkDocumentPdf doc={doc} profile={profile} />).toBlob();
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.setAttribute(
    "style",
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  );
  document.body.appendChild(iframe);
  iframe.src = url;

  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };

  const runPrint = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.setTimeout(() => {
        cleanup();
        resolve();
      }, 400);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };

    const tryPrint = () => {
      try {
        runPrint();
        finish();
      } catch (e) {
        fail(e);
      }
    };

    iframe.onload = () => window.setTimeout(tryPrint, 150);
    iframe.onerror = () => fail(new Error("PDF konnte nicht geladen werden."));
    window.setTimeout(() => {
      if (!settled) tryPrint();
    }, 2000);
  });
}
