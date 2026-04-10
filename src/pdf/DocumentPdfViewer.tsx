import type { CSSProperties } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import { WerkDocumentPdf } from "./WerkDocumentPdf";
import type { Document as BizDocument, Profile } from "../types";

const iframeStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  border: "none",
  display: "block",
};

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
    <div className={className ?? "h-full w-full min-h-0"} style={{ minHeight: 0 }}>
      <PDFViewer showToolbar style={iframeStyle}>
        <WerkDocumentPdf doc={doc} profile={profile} />
      </PDFViewer>
    </div>
  );
}
