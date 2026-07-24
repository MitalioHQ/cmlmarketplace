export type CountryCode = string;
export type CurrencyCode = string;

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export interface CatalogChannel {
  id: string;
  slug: string;
  displayName: string;
  websiteUrl?: string;
  termsUrl?: string;
  privacyUrl?: string;
  supportUrl?: string;
}

export interface CatalogFallback {
  title: string;
  message: string;
  url?: string;
}

export interface CatalogProduct {
  id: string;
  code: string;
  title: string;
  description: string;
  price: Money;
  position: number;
  purchasable: boolean;
  category?: string;
  badge?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface Catalog {
  channel: CatalogChannel;
  countryCode?: CountryCode;
  available: boolean;
  fallback?: CatalogFallback;
  products: readonly CatalogProduct[];
  fetchedAt: string;
}

export interface CustomerInput {
  email: string;
  firstName: string;
  lastName: string;
  countryCode?: CountryCode;
  phone?: string;
  company?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  taxId?: string;
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
  targetId?: string;
  targetHost?: string;
}

export interface OrderPreviewRequest {
  channelSlug: string;
  customer: CustomerInput;
  items: readonly OrderItemInput[];
  referralCode?: string;
}

export interface OrderPreviewItem {
  productId: string;
  code: string;
  title: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  targetId?: string;
  targetHost?: string;
}

export interface OrderTotals {
  subtotal: Money;
  discount: Money;
  total: Money;
}

export interface OrderPreview {
  id: string;
  channel: CatalogChannel;
  customer: CustomerInput;
  items: readonly OrderPreviewItem[];
  totals: OrderTotals;
  warnings: readonly string[];
  expiresAt: string;
}

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type FulfillmentStatus =
  | "not_started"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface CommerceOrder {
  id: string;
  code: string;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  customerId: string;
  channel: CatalogChannel;
  items: readonly OrderPreviewItem[];
  totals: OrderTotals;
  amountPaid: Money;
  amountDue: Money;
  createdAt: string;
  confirmedAt?: string;
  paidAt?: string;
}

export type PaymentStatus = "captured" | "failed" | "refunded";

export interface RecordPaymentRequest {
  orderId: string;
  provider: string;
  providerTransactionId: string;
  providerEventId: string;
  status: PaymentStatus;
  amount: Money;
  occurredAt: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  status: PaymentStatus;
  provider: string;
  providerTransactionId: string;
  amount: Money;
  occurredAt: string;
  recordedAt: string;
}

export interface PaymentResult {
  payment: PaymentRecord;
  order: CommerceOrder;
}

