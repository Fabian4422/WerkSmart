import type { CSSProperties } from "react";
import { BlobProvider } from "@react-pdf/renderer";
import { WerkDocumentPdf } from "./WerkDocumentPdf";
import type { Document as BizDocument, Profile } from "../types";

const iframeStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  border: "none",
  display: "block",
};

/** Chrome/Edge: eingebettete PDF-UI ausblenden (nur App-Buttons für Druck/Download). */
const EMBED_PDF_PARAMS = "toolbar=0&navpanes=0&view=FitH";

export function DocumentPdfViewer({
  doc,
  profile,
  className,
}: {
  doc: BizDocument;
  profile: Profile | null;
  className?: string;
}) {
  const document = <WerkDocumentPdf doc={doc} profile={profile} />;

  return (
    <div className={className ?? "h-full w-full min-h-0"} style={{ minHeight: 0 }}>
      <BlobProvider document={document}>
        {({ url, loading, error }) => {
          if (error) {
            return (
              <div className="flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm text-red-600">
                PDF-Vorschau konnte nicht erzeugt werden.
              </div>
            );
          }
          if (!url) {
            return (
              <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-stone-500">
                {loading ? "Vorschau wird geladen…" : "—"}
              </div>
            );
          }
          return (
            <iframe
              title="PDF-Vorschau"
              src={`${url}#${EMBED_PDF_PARAMS}`}
              style={iframeStyle}
            />
          );
        }}
      </BlobProvider>
    </div>
  );
}
