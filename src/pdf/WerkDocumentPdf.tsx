import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { Document as BizDocument, Profile } from "../types";

const MM_TO_PT = 72 / 25.4;
const PAD_MM = 20;
const PAGE_PAD = PAD_MM * MM_TO_PT;
const LOGO_SIZE_DEFAULT = 68;
const LOGO_SIZE_MIN = 32;
const LOGO_SIZE_MAX = 120;

/** Platz für fixierten Footer (Linie + Bank + Steuer) — Inhalt darf nicht darüber schreiben. */
const FIXED_FOOTER_RESERVE = 132;

const colors = {
  black: "#0c0a09",
  gray500: "#78716c",
  gray400: "#a8a29e",
  gray600: "#57534e",
  line: "#0c0a09",
  rule: "#e7e5e4",
};

function clampLogoSize(value: unknown, fallback = LOGO_SIZE_DEFAULT): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(parsed)));
}

const styles = StyleSheet.create({
  page: {
    paddingLeft: PAGE_PAD,
    paddingRight: PAGE_PAD,
    paddingBottom: PAGE_PAD + FIXED_FOOTER_RESERVE,
    paddingTop: PAGE_PAD,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: colors.black,
  },
  headerTopRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  senderCol: {
    flex: 1,
    paddingRight: 12,
  },
  companyName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  senderMuted: {
    fontSize: 8.5,
    color: colors.gray500,
    lineHeight: 1.45,
  },
  senderContact: {
    marginTop: 8,
  },
  logoImg: {
    objectFit: "contain",
  },
  returnLine: {
    fontSize: 7,
    color: colors.gray400,
    textDecoration: "underline",
    marginBottom: 4,
  },
  recipientName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  recipientBlock: {
    marginBottom: 22,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 10,
  },
  titleLeft: {
    flex: 1,
  },
  docTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  docNr: {
    fontSize: 8.5,
    color: colors.gray500,
  },
  dateCol: {
    width: 120,
    alignItems: "flex-end",
  },
  dateLabel: {
    fontSize: 7,
    color: colors.gray400,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  dateValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: colors.line,
    paddingBottom: 3,
    marginTop: 0,
  },
  thPos: { width: "7%", fontSize: 7.5, fontFamily: "Helvetica-Bold" },
  thLeistung: {
    width: "41%",
    paddingLeft: 4,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
  },
  thMenge: {
    width: "18%",
    textAlign: "right",
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  thPreis: {
    width: "17%",
    textAlign: "right",
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
  },
  thGesamt: {
    width: "17%",
    textAlign: "right",
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  itemRow: {
    flexDirection: "row",
    paddingTop: 3,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f4",
    alignItems: "flex-start",
  },
  tdPos: {
    width: "7%",
    fontSize: 8,
    color: "#a8a29e",
  },
  tdTitle: {
    width: "41%",
    paddingLeft: 4,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  tdMenge: {
    width: "18%",
    textAlign: "right",
    fontSize: 8,
  },
  tdPreis: {
    width: "17%",
    textAlign: "right",
    fontSize: 8,
  },
  tdGesamt: {
    width: "17%",
    textAlign: "right",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  totalsWrap: {
    marginTop: 18,
    marginBottom: 8,
    alignItems: "flex-end",
  },
  totalsTable: {
    width: 220,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 3,
    paddingBottom: 3,
  },
  totalLabel: {
    fontSize: 9,
    color: colors.gray500,
  },
  totalValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  totalFinalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 2,
    borderTopColor: colors.line,
    paddingTop: 6,
    marginTop: 4,
  },
  totalFinalText: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  fixedPageFooter: {
    position: "absolute",
    bottom: PAGE_PAD,
    left: PAGE_PAD,
    right: PAGE_PAD,
    backgroundColor: "#ffffff",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  footerRow: {
    flexDirection: "row",
  },
  footerCol: {
    width: "50%",
    paddingRight: 8,
  },
  footerColRight: {
    width: "50%",
    paddingLeft: 8,
    alignItems: "flex-end",
  },
  footerHeading: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.gray600,
    textTransform: "uppercase",
    marginBottom: 4,
    letterSpacing: 0.4,
  },
  footerHeadingRight: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.gray600,
    textTransform: "uppercase",
    marginBottom: 4,
    letterSpacing: 0.4,
    width: "100%",
    textAlign: "right",
  },
  footerText: {
    fontSize: 7.5,
    color: colors.gray500,
    lineHeight: 1.45,
  },
  footerTextRight: {
    fontSize: 7.5,
    color: colors.gray500,
    lineHeight: 1.45,
    textAlign: "right",
  },
});

function formatDocDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "dd.MM.yyyy");
}

function formatMoney(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BankSteuerFooter({ profile }: { profile: Profile | null }) {
  return (
    <View fixed style={styles.fixedPageFooter}>
      <View style={styles.footerRow}>
        <View style={styles.footerCol}>
          <Text style={styles.footerHeading}>Bankverbindung</Text>
          <Text style={styles.footerText}>{profile?.bankName || "—"}</Text>
          <Text style={styles.footerText}>IBAN: {profile?.iban || "—"}</Text>
          <Text style={styles.footerText}>BIC: {profile?.bic || "—"}</Text>
        </View>
        <View style={styles.footerColRight}>
          <Text style={styles.footerHeadingRight}>Steuerdaten</Text>
          <Text style={styles.footerTextRight}>Steuernummer: {profile?.taxNumber || "—"}</Text>
          {profile?.vatId ? <Text style={styles.footerTextRight}>USt-ID: {profile.vatId}</Text> : null}
          {profile?.isSmallBusiness ? (
            <Text style={[styles.footerTextRight, { marginTop: 4, fontStyle: "italic" }]}>
              Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function WerkDocumentPdf({
  doc,
  profile,
}: {
  doc: BizDocument;
  profile: Profile | null;
}) {
  const title = doc.type === "offer" ? "Angebot" : "Rechnung";
  const logoSrc = profile?.logoUrl?.trim() || "";
  const effectiveLogoSize = clampLogoSize(
    doc.logoSizeOverride ?? profile?.logoSize ?? LOGO_SIZE_DEFAULT,
    LOGO_SIZE_DEFAULT
  );
  const returnLine = [profile?.companyName, profile?.address]
    .filter(Boolean)
    .join(" • ");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View wrap={false}>
          <View style={styles.headerTopRow}>
            <View style={styles.senderCol}>
              <Text style={styles.companyName}>{profile?.companyName || "—"}</Text>
              {profile?.legalForm ? (
                <Text style={styles.senderMuted}>{profile.legalForm}</Text>
              ) : null}
              {profile?.address ? <Text style={styles.senderMuted}>{profile.address}</Text> : null}
              <View style={styles.senderContact}>
                <Text style={styles.senderMuted}>
                  {[profile?.phone, profile?.email].filter(Boolean).join(" | ") || "—"}
                </Text>
              </View>
            </View>
            {logoSrc ? (
              <Image
                src={logoSrc}
                style={[styles.logoImg, { width: effectiveLogoSize, height: effectiveLogoSize }]}
              />
            ) : null}
          </View>

          <View style={styles.recipientBlock}>
            {returnLine ? <Text style={styles.returnLine}>{returnLine}</Text> : null}
            <Text style={styles.recipientName}>{doc.customerName || "—"}</Text>
          </View>

          <View style={styles.titleRow}>
            <View style={styles.titleLeft}>
              <Text style={styles.docTitle}>{title}</Text>
              <Text style={styles.docNr}>Nr. {doc.docNumber || "—"}</Text>
            </View>
            <View style={styles.dateCol}>
              <Text style={styles.dateLabel}>Datum</Text>
              <Text style={styles.dateValue}>{formatDocDate(doc.date || "")}</Text>
            </View>
          </View>

          <View style={styles.tableHead}>
            <Text style={styles.thPos}>Pos.</Text>
            <Text style={styles.thLeistung}>Leistung</Text>
            <Text style={styles.thMenge}>Menge</Text>
            <Text style={styles.thPreis}>Preis</Text>
            <Text style={styles.thGesamt}>Gesamt</Text>
          </View>
        </View>

        {(doc.items || []).map((item, i) => (
          <View key={`pos-${i}-${item.title}`} style={styles.itemRow} wrap={false}>
            <Text style={styles.tdPos}>{i + 1}</Text>
            <Text style={styles.tdTitle}>{item.title}</Text>
            <Text style={styles.tdMenge}>
              {item.quantity} {item.unit}
            </Text>
            <Text style={styles.tdPreis}>{formatMoney(item.price)} €</Text>
            <Text style={styles.tdGesamt}>{formatMoney(item.total)} €</Text>
          </View>
        ))}

        <View style={styles.totalsWrap} wrap={false}>
          <View style={styles.totalsTable}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Netto</Text>
              <Text style={styles.totalValue}>{formatMoney(doc.totalNet)} €</Text>
            </View>
            {!profile?.isSmallBusiness && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>MwSt. ({profile?.vatRate ?? 19}%)</Text>
                <Text style={styles.totalValue}>{formatMoney(doc.totalVat)} €</Text>
              </View>
            )}
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalText}>Gesamt</Text>
              <Text style={styles.totalFinalText}>{formatMoney(doc.totalGross)} €</Text>
            </View>
          </View>
        </View>

        <BankSteuerFooter profile={profile} />
      </Page>
    </Document>
  );
}
