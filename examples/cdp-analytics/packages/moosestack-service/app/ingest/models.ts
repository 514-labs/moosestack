/**
 * Customer Data Platform - Data Models
 *
 * These models are designed to be compatible with real-world CDP data sources:
 * - Google Analytics 4 (GA4) - Web analytics and event tracking
 * - Segment - Customer data infrastructure and event routing
 * - Meta Conversions API - Facebook/Instagram ad attribution
 * - Square Orders API - Point-of-sale and e-commerce transactions
 * - Google Ads API - Campaign performance metrics
 *
 * @see INGEST_SCHEMAS_REFERENCE.md for detailed field mappings
 */

import { IngestPipeline, Key } from "@514labs/moose-lib";

// ============================================================================
// CUSTOMER MODEL
// ============================================================================

/**
 * Customer profile data for identity resolution and segmentation.
 *
 * Compatible with:
 * - Segment Identify calls (userId, traits)
 * - Meta Conversions API user_data parameters
 * - Square Customer API
 *
 * @example
 * // Segment-style identify
 * { userId: "cust_123", traits: { email, firstName, lastName } }
 *
 * // Meta CAPI user matching
 * { em: hash(email), ph: hash(phone), external_id: hash(customerId) }
 */
export interface Customer {
  /**
   * Unique customer identifier (UUID format).
   * Maps to: Segment userId, Meta external_id, Square customer_id
   */
  customerId: Key<string>;

  /**
   * External system ID for cross-platform identity resolution.
   * Use for linking to CRM, ERP, or other business systems.
   * @source Segment - external_ids array
   * @source Meta CAPI - external_id (hashed)
   */
  externalId: string;

  /**
   * Customer email address - primary contact and identity key.
   * @source Meta CAPI - em parameter (should be hashed for Meta)
   * @source Segment - traits.email
   */
  email: string;

  /** Customer first name. @source Meta CAPI - fn parameter */
  firstName: string;

  /** Customer last name. @source Meta CAPI - ln parameter */
  lastName: string;

  /**
   * Phone number in E.164 format (e.g., +14155551234).
   * @source Meta CAPI - ph parameter (digits only, hashed)
   */
  phone: string;

  /**
   * ISO 3166-1 alpha-2 country code (e.g., "US", "GB").
   * @source Meta CAPI - country parameter
   * @source GA4 - geo.country
   */
  country: string;

  /**
   * City of residence.
   * @source Meta CAPI - ct parameter (lowercase, no spaces)
   */
  city: string;

  /**
   * Date of birth for age segmentation.
   * @source Meta CAPI - db parameter (YYYYMMDD format)
   */
  dateOfBirth: Date;

  /**
   * Gender for demographic segmentation.
   * Values: male, female, other, prefer_not_to_say
   * @source Meta CAPI - ge parameter (m or f)
   */
  gender: string;

  /** Account creation timestamp in UTC. */
  createdAt: Date;

  /** Last profile update timestamp in UTC. */
  updatedAt: Date;

  /**
   * Marketing acquisition channel.
   * Values: organic, paid_search, social, referral, email
   * @source GA4 - first_user_source / first_user_medium
   */
  acquisitionChannel: string;

  /**
   * Specific campaign that acquired this customer.
   * @source GA4 - first_user_campaign
   * @source UTM - utm_campaign from first visit
   */
  acquisitionCampaign: string;

  /**
   * Customer lifetime value in USD.
   * @source GA4 - user_ltv_revenue
   * @source Meta CAPI - predicted_ltv
   */
  lifetimeValue: number;

  /**
   * Customer tier for segmentation.
   * Values: bronze, silver, gold, platinum
   */
  customerTier: string;

  /** Whether customer has opted into marketing communications. */
  marketingOptIn: boolean;

  /**
   * Meta/Facebook Click ID - captures the fbclid URL parameter.
   * Format: fb.1.{timestamp}.{fbclid}
   * Used for ad attribution and conversion tracking.
   * @source Meta CAPI - fbc parameter (not hashed)
   * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
   */
  fbc: string;

  /**
   * Meta/Facebook Browser ID - from _fbp first-party cookie.
   * Format: fb.1.{timestamp}.{random}
   * Persists across sessions for cross-session attribution.
   * @source Meta CAPI - fbp parameter (not hashed)
   */
  fbp: string;

  /**
   * User consent status for data processing (GDPR/CCPA compliance).
   * Values: granted, denied, pending
   * @source GA4 - consent_state
   * @source Meta CAPI - data_processing_options
   */
  consentStatus: string;
}

export const CustomerPipeline = new IngestPipeline<Customer>("Customer", {
  table: true,
  stream: true,
  ingestApi: true,
});

// ============================================================================
// EVENT MODEL
// ============================================================================

/**
 * Behavioral events tracking user interactions across all touchpoints.
 *
 * Compatible with:
 * - Google Analytics 4 events (page_view, click, purchase, etc.)
 * - Segment Track calls
 * - Meta Pixel/CAPI events
 *
 * @example
 * // GA4 event structure
 * { event_name: "purchase", params: { transaction_id, value, currency, items } }
 *
 * // Segment track
 * { event: "Order Completed", properties: { orderId, total, products } }
 */
export interface Event {
  /**
   * Unique event identifier for deduplication.
   * @source Segment - messageId
   * @source Meta CAPI - event_id
   */
  eventId: Key<string>;

  /**
   * Persistent browser/device identifier (GA4-style).
   * Stored in _ga cookie, persists across sessions.
   * Format: {random}.{timestamp}
   * @source GA4 - client_id
   * @source gtag - cid parameter
   */
  clientId: string;

  /**
   * Anonymous visitor ID before authentication (Segment-style).
   * Generated client-side, used for identity stitching after login.
   * @source Segment - anonymousId
   * @source Amplitude - device_id
   */
  anonymousId: string;

  /**
   * Authenticated customer ID (empty if anonymous).
   * @source Segment - userId
   * @source GA4 - user_id
   */
  customerId: string;

  /**
   * Session identifier linking events within a user session.
   * @source GA4 - ga_session_id
   * @source Segment - context.session_id
   */
  sessionId: string;

  /** Event timestamp in UTC. @source GA4 - event_timestamp */
  timestamp: Date;

  /**
   * Event type category.
   * Values: page_view, click, form_submit, purchase, add_to_cart,
   *         remove_from_cart, search, login, logout
   * @source GA4 - event_name (standardized)
   * @source Meta CAPI - event_name
   */
  eventType: string;

  /**
   * Specific event name within the category.
   * @source GA4 - custom event names
   * @source Segment - event property
   */
  eventName: string;

  /**
   * Full page URL where event occurred.
   * @source GA4 - page_location
   * @source Segment - context.page.url
   * @source Meta CAPI - event_source_url
   */
  pageUrl: string;

  /**
   * Page title where event occurred.
   * @source GA4 - page_title
   * @source Segment - context.page.title
   */
  pageTitle: string;

  /**
   * Referring URL if applicable.
   * @source GA4 - page_referrer
   * @source Segment - context.page.referrer
   */
  referrerUrl: string;

  /**
   * Device type classification.
   * Values: desktop, mobile, tablet
   * @source GA4 - device.category
   * @source Segment - context.device.type
   */
  deviceType: string;

  /**
   * Browser name and version.
   * @source GA4 - device.browser
   * @source Segment - context.userAgent (parsed)
   */
  browser: string;

  /**
   * Operating system name and version.
   * @source GA4 - device.os
   * @source Segment - context.os.name + context.os.version
   */
  operatingSystem: string;

  /**
   * IP-derived country code (ISO 3166-1 alpha-2).
   * @source GA4 - geo.country
   * @source Segment - context.location.country
   */
  ipCountry: string;

  /**
   * IP-derived city.
   * @source GA4 - geo.city
   * @source Segment - context.location.city
   */
  ipCity: string;

  /**
   * UTM source parameter for campaign tracking.
   * @source GA4 - traffic_source.source
   * @source Segment - context.campaign.source
   */
  utmSource: string;

  /**
   * UTM medium parameter for campaign tracking.
   * @source GA4 - traffic_source.medium
   * @source Segment - context.campaign.medium
   */
  utmMedium: string;

  /**
   * UTM campaign parameter for campaign tracking.
   * @source GA4 - traffic_source.campaign
   * @source Segment - context.campaign.name
   */
  utmCampaign: string;

  /**
   * JSON string containing additional event-specific properties.
   * Structure varies by event type (e.g., items[] for e-commerce).
   * @source GA4 - event parameters
   * @source Segment - properties object
   */
  properties: string;
}

export const EventPipeline = new IngestPipeline<Event>("Event", {
  table: true,
  stream: true,
  ingestApi: true,
});

// ============================================================================
// TRANSACTION MODEL
// ============================================================================

/**
 * Purchase and order data for revenue analytics.
 *
 * Compatible with:
 * - Square Orders API
 * - GA4 purchase event
 * - Segment Order Completed event
 * - Meta CAPI Purchase event
 *
 * @example
 * // Square Order
 * { id, location_id, state: "COMPLETED", total_money: { amount, currency } }
 *
 * // GA4 purchase
 * { transaction_id, value, currency, tax, shipping, items }
 */
export interface Transaction {
  /**
   * Unique transaction identifier.
   * @source Square - order.id
   * @source GA4 - transaction_id
   * @source Segment - properties.order_id
   */
  transactionId: Key<string>;

  /**
   * Customer who made this purchase.
   * @source Square - order.customer_id
   */
  customerId: string;

  /** Session during which purchase was made. */
  sessionId: string;

  /**
   * Transaction timestamp in UTC.
   * @source Square - order.created_at
   */
  timestamp: Date;

  /**
   * Order lifecycle state (Square-style).
   * Values: OPEN, COMPLETED, CANCELED, DRAFT
   * @source Square - order.state
   */
  orderState: string;

  /**
   * Payment/fulfillment status.
   * Values: pending, completed, refunded, cancelled, failed
   * @source Square - payment.status, fulfillment.state
   */
  status: string;

  /**
   * Order source channel.
   * Values: online, pos, api, mobile_app
   * @source Square - order.source.name
   */
  source: string;

  /**
   * Order subtotal before discounts (USD).
   * @source Square - order.total_money minus adjustments
   * @source GA4 - value (before tax/shipping)
   */
  subtotal: number;

  /**
   * Discount amount applied (USD).
   * @source Square - order.total_discount_money.amount / 100
   * @source GA4 - discount parameter
   */
  discountAmount: number;

  /**
   * Tax amount (USD).
   * @source Square - order.total_tax_money.amount / 100
   * @source GA4 - tax parameter
   */
  taxAmount: number;

  /**
   * Shipping cost (USD).
   * @source GA4 - shipping parameter
   * @source Segment - properties.shipping
   */
  shippingAmount: number;

  /**
   * Tip amount for hospitality/food service (USD).
   * @source Square - order.total_tip_money.amount / 100
   */
  tipAmount: number;

  /**
   * Final order total including all adjustments (USD).
   * @source Square - order.total_money.amount / 100
   * @source GA4 - value
   * @source Meta CAPI - value
   */
  totalAmount: number;

  /**
   * ISO 4217 currency code (e.g., "USD").
   * @source Square - order.total_money.currency
   * @source GA4 - currency
   * @source Meta CAPI - currency
   */
  currency: string;

  /**
   * Payment method used.
   * Values: credit_card, debit_card, paypal, apple_pay, google_pay, bank_transfer
   * @source Square - tender.type (CARD, CASH, etc.)
   */
  paymentMethod: string;

  /**
   * Promo or coupon code applied.
   * @source GA4 - coupon parameter
   * @source Segment - properties.coupon
   */
  couponCode: string;

  /**
   * Number of items in the order.
   * @source Meta CAPI - num_items
   */
  itemCount: number;

  /** Shipping destination country code. */
  shippingCountry: string;

  /** Shipping destination city. */
  shippingCity: string;

  /**
   * Whether this is customer's first purchase.
   * @source GA4 - first_purchase event
   * @source Meta CAPI - customer_type: "new"
   */
  isFirstPurchase: boolean;

  /**
   * Attribution channel for this transaction.
   * @source GA4 - session_source
   */
  attributionChannel: string;
}

export const TransactionPipeline = new IngestPipeline<Transaction>(
  "Transaction",
  {
    table: true,
    stream: true,
    ingestApi: true,
  },
);

// ============================================================================
// TRANSACTION ITEM MODEL
// ============================================================================

/**
 * Individual line items within transactions.
 *
 * Compatible with:
 * - Square OrderLineItem
 * - GA4 items[] array
 * - Segment products[] array
 * - Meta CAPI contents[] array
 *
 * @example
 * // GA4 item
 * { item_id, item_name, price, quantity, item_category }
 *
 * // Square line item
 * { uid, name, quantity, base_price_money }
 */
export interface TransactionItem {
  /**
   * Unique line item identifier.
   * @source Square - line_item.uid
   */
  itemId: Key<string>;

  /**
   * Parent transaction reference.
   * @source Square - order.id
   */
  transactionId: string;

  /** Customer reference. */
  customerId: string;

  /**
   * Product SKU identifier.
   * @source GA4 - item_id
   * @source Segment - product_id
   * @source Meta CAPI - content_ids[]
   */
  productSku: string;

  /**
   * Product display name.
   * @source GA4 - item_name
   * @source Square - line_item.name
   */
  productName: string;

  /**
   * Product category.
   * Values: electronics, clothing, home, beauty, sports, food, other
   * @source GA4 - item_category
   * @source Meta CAPI - content_category
   */
  productCategory: string;

  /**
   * Product subcategory for detailed classification.
   * @source GA4 - item_category2 through item_category5
   */
  productSubcategory: string;

  /**
   * Unit price (USD).
   * @source GA4 - price
   * @source Square - base_price_money.amount / 100
   * @source Meta CAPI - contents[].item_price
   */
  unitPrice: number;

  /**
   * Quantity purchased.
   * @source GA4 - quantity
   * @source Square - line_item.quantity
   * @source Meta CAPI - contents[].quantity
   */
  quantity: number;

  /**
   * Line item total (unitPrice * quantity).
   * @source Square - line_item.total_money.amount / 100
   */
  lineTotal: number;

  /**
   * Discount applied to this item (USD).
   * @source GA4 - discount (item-level)
   * @source Square - line_item.total_discount_money.amount / 100
   */
  itemDiscount: number;

  /** Timestamp of the transaction. */
  timestamp: Date;
}

export const TransactionItemPipeline = new IngestPipeline<TransactionItem>(
  "TransactionItem",
  {
    table: true,
    stream: true,
    ingestApi: true,
  },
);

// ============================================================================
// SESSION MODEL
// ============================================================================

/**
 * User session data for engagement and journey analysis.
 *
 * Compatible with:
 * - GA4 session metrics
 * - Segment session tracking
 *
 * @example
 * // GA4 session
 * { ga_session_id, ga_session_number, engaged_session }
 */
export interface Session {
  /**
   * Unique session identifier.
   * @source GA4 - ga_session_id
   */
  sessionId: Key<string>;

  /**
   * Persistent browser/device identifier (GA4-style).
   * Same user may have multiple sessions with same clientId.
   * @source GA4 - client_id
   */
  clientId: string;

  /**
   * Authenticated customer ID (empty if anonymous session).
   * @source GA4 - user_id
   * @source Segment - userId
   */
  customerId: string;

  /**
   * Anonymous visitor ID for non-authenticated sessions.
   * @source Segment - anonymousId
   */
  anonymousId: string;

  /** Session start timestamp in UTC. */
  startedAt: Date;

  /** Session end timestamp in UTC. */
  endedAt: Date;

  /**
   * Session duration in seconds.
   * @source GA4 - engagement_time_msec / 1000
   */
  durationSeconds: number;

  /**
   * Total page views in session.
   * @source GA4 - page_view event count
   */
  pageViewCount: number;

  /**
   * Total events in session.
   * @source GA4 - event_count
   */
  eventCount: number;

  /**
   * First page URL visited (entry point).
   * @source GA4 - landing_page
   */
  landingPage: string;

  /**
   * Last page URL before session end.
   * @source GA4 - exit_page
   */
  exitPage: string;

  /**
   * Device type classification.
   * Values: desktop, mobile, tablet
   * @source GA4 - device.category
   */
  deviceType: string;

  /**
   * Browser name and version.
   * @source GA4 - device.browser
   */
  browser: string;

  /**
   * Operating system name and version.
   * @source GA4 - device.os
   */
  operatingSystem: string;

  /**
   * Screen resolution.
   * @source GA4 - device.screen_resolution
   * @source Segment - context.screen.width x context.screen.height
   */
  screenResolution: string;

  /**
   * Traffic source category.
   * Values: direct, organic_search, paid_search, social, referral, email
   * @source GA4 - session_default_channel_group
   */
  trafficSource: string;

  /**
   * Referring domain if applicable.
   * @source GA4 - session_source
   */
  referrerDomain: string;

  /** UTM source for session. @source GA4 - session_source */
  utmSource: string;

  /** UTM medium for session. @source GA4 - session_medium */
  utmMedium: string;

  /** UTM campaign for session. @source GA4 - session_campaign */
  utmCampaign: string;

  /** IP-derived country code. @source GA4 - geo.country */
  ipCountry: string;

  /** IP-derived city. @source GA4 - geo.city */
  ipCity: string;

  /**
   * Whether session resulted in a purchase.
   * @source GA4 - session_conversion (for purchase goal)
   */
  hasConversion: boolean;

  /**
   * Conversion value if purchase occurred (USD).
   * @source GA4 - session_value
   */
  conversionValue: number;
}

export const SessionPipeline = new IngestPipeline<Session>("Session", {
  table: true,
  stream: true,
  ingestApi: true,
});

// ============================================================================
// PRODUCT MODEL
// ============================================================================

/**
 * Product catalog data for product analytics.
 *
 * Compatible with:
 * - Square Catalog API
 * - GA4 item parameters
 * - Segment product properties
 */
export interface Product {
  /**
   * Product SKU identifier.
   * @source Square - catalog_object.id
   * @source GA4 - item_id
   */
  productSku: Key<string>;

  /**
   * Product display name.
   * @source Square - item_data.name
   * @source GA4 - item_name
   */
  productName: string;

  /** Product description. */
  description: string;

  /**
   * Product category.
   * @source GA4 - item_category
   */
  category: string;

  /**
   * Product subcategory.
   * @source GA4 - item_category2
   */
  subcategory: string;

  /**
   * Brand name.
   * @source GA4 - item_brand
   */
  brand: string;

  /**
   * Current price (USD).
   * @source Square - item_variation.price_money.amount / 100
   * @source GA4 - price
   */
  price: number;

  /**
   * Original price before discount (USD).
   * Used to calculate discount percentage.
   */
  originalPrice: number;

  /** Cost of goods sold (USD) for margin analysis. */
  costPrice: number;

  /** Current inventory quantity. */
  stockQuantity: number;

  /** Whether product is currently active/visible. */
  isActive: boolean;

  /** Product creation date. */
  createdAt: Date;

  /** Last update timestamp. */
  updatedAt: Date;

  /** Average customer rating (1-5 scale). */
  avgRating: number;

  /** Total number of customer reviews. */
  reviewCount: number;
}

export const ProductPipeline = new IngestPipeline<Product>("Product", {
  table: true,
  stream: true,
  ingestApi: true,
});
