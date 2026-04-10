import { PDFViewer } from "@react-pdf/renderer";
import { WerkDocumentPdf } from "./WerkDocumentPdf";
import type { Document as BizDocument, Profile } from "../types";

export function DocumentPdfViewer({
  doc,
  profile,
  className,
}: {
  doc: BizDocument;
  profile: Profile | null;
  className?: string;
}) {
  return (
    <div className={className ?? "h-full w-full min-h-[480px]"}>
      <PDFViewer
        width="100%"
        height="100%"
        showToolbar
        style={{ width: "100%", height: "100%", border: "none" }}
      >
        <WerkDocumentPdf doc={doc} profile={profile} />
      </PDFViewer>
    </div>
  );
}
