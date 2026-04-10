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
