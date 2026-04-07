export interface Profile {
  id?: number;
  companyName: string;
  legalForm: string;
  owner: string;
  address: string;
  phone: string;
  email: string;
  taxNumber: string;
  vatId?: string;
  vatRate: number;
  isSmallBusiness: boolean;
  bankName: string;
  iban: string;
  bic: string;
  accountHolder: string;
  logoUrl?: string;
  paymentTerms: number;
  discount: number;
  offerValidity: number;
  currency: string;
}

export interface LaborRate {
  id?: number;
  title: string;
  rate: number;
}

export interface Service {
  id?: number;
  title: string;
  unit: string;
  price: number;
}

export interface DocumentItem {
  title: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;

  // Standardleistung: Einheit ist vom Nutzer-Leistungskatalog vorgegeben und darf im Dokument nicht geändert werden.
  // Eigene Leistung: Einheit kann (aktuell) noch frei gewählt/angepasst werden.
  unitLocked?: boolean;
  serviceId?: number;
  source?: "service" | "custom";
}

export interface Document {
  id?: number;
  type: 'offer' | 'invoice';
  docNumber: string;
  customerName: string;
  date: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  items: DocumentItem[];
  status?: string;
}
