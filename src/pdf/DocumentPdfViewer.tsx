import { useMemo, type CSSProperties } from "react";
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
  const isMobileLike = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 768px)").matches || "ontouchstart" in window;
  }, []);

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
          if (isMobileLike) {
            return (
              <div className="flex h-full w-full items-center justify-center p-5">
                <div className="w-full max-w-sm rounded-2xl bg-stone-900 p-5 text-center text-white shadow-2xl">
                  <p className="mb-4 text-sm text-stone-200">
                    Auf Mobilgeraten ist die eingebettete PDF-Vorschau oft eingeschrankt.
                  </p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-blue-300 px-4 py-3 font-bold text-stone-900 hover:bg-blue-200"
                  >
                    PDF offnen
                  </a>
                </div>
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
