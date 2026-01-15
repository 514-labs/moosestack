/**
 * Segment Webhook Receiver
 *
 * Demonstrates receiving webhooks from external services and transforming
 * the data to match our internal models.
 *
 * This endpoint receives Segment Track/Identify events and transforms them
 * to our Event/Customer models.
 *
 * Use case: Receiving data from Segment, Rudderstack, Zapier, or other CDP sources
 *
 * @see https://segment.com/docs/connections/spec/
 */

import express from "express";
import { WebApp } from "@514labs/moose-lib";

const app = express();
app.use(express.json());

// Segment event types
interface SegmentTrackEvent {
  type: "track";
  messageId: string;
  anonymousId?: string;
  userId?: string;
  event: string;
  properties?: Record<string, any>;
  context?: {
    page?: {
      url?: string;
      title?: string;
      referrer?: string;
    };
    userAgent?: string;
    ip?: string;
    campaign?: {
      source?: string;
      medium?: string;
      name?: string;
    };
    device?: {
      type?: string;
    };
    os?: {
      name?: string;
      version?: string;
    };
    location?: {
      country?: string;
      city?: string;
    };
  };
  timestamp?: string;
  sentAt?: string;
}

interface SegmentIdentifyEvent {
  type: "identify";
  messageId: string;
  anonymousId?: string;
  userId: string;
  traits?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: {
      country?: string;
      city?: string;
    };
    [key: string]: any;
  };
  context?: Record<string, any>;
  timestamp?: string;
}

type SegmentEvent = SegmentTrackEvent | SegmentIdentifyEvent;

/**
 * Transform Segment Track event to our Event model
 */
function transformTrackEvent(segment: SegmentTrackEvent) {
  const ctx = segment.context || {};
  const page = ctx.page || {};
  const campaign = ctx.campaign || {};
  const location = ctx.location || {};

  // Map Segment event names to our event types
  const eventTypeMap: Record<string, string> = {
    "Page Viewed": "page_view",
    "Button Clicked": "click",
    "Form Submitted": "form_submit",
    "Product Added": "add_to_cart",
    "Product Removed": "remove_from_cart",
    "Order Completed": "purchase",
    "Products Searched": "search",
    "User Signed In": "login",
    "User Signed Out": "logout",
  };

  return {
    eventId: segment.messageId,
    clientId: segment.anonymousId || "",
    anonymousId: segment.anonymousId || "",
    customerId: segment.userId || "",
    sessionId: "", // Segment doesn't provide this directly
    timestamp: segment.timestamp || new Date().toISOString(),
    eventType: eventTypeMap[segment.event] || "custom",
    eventName: segment.event,
    pageUrl: page.url || "",
    pageTitle: page.title || "",
    referrerUrl: page.referrer || "",
    deviceType: ctx.device?.type || "unknown",
    browser: ctx.userAgent?.split(" ")[0] || "unknown",
    operatingSystem:
      ctx.os ?
        `${ctx.os.name || ""} ${ctx.os.version || ""}`.trim()
      : "unknown",
    ipCountry: location.country || "",
    ipCity: location.city || "",
    utmSource: campaign.source || "",
    utmMedium: campaign.medium || "",
    utmCampaign: campaign.name || "",
    properties: JSON.stringify(segment.properties || {}),
  };
}

/**
 * Transform Segment Identify event to our Customer model
 */
function transformIdentifyEvent(segment: SegmentIdentifyEvent) {
  const traits = segment.traits || {};
  const address = traits.address || {};

  return {
    customerId: segment.userId,
    externalId: segment.anonymousId || "",
    email: traits.email || "",
    firstName: traits.firstName || "",
    lastName: traits.lastName || "",
    phone: traits.phone || "",
    country: address.country || "",
    city: address.city || "",
    dateOfBirth:
      traits.birthday ?
        new Date(traits.birthday).toISOString()
      : new Date("2000-01-01").toISOString(),
    gender: traits.gender || "prefer_not_to_say",
    createdAt: segment.timestamp || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acquisitionChannel: "webhook",
    acquisitionCampaign: "segment",
    lifetimeValue: 0,
    customerTier: "bronze",
    marketingOptIn: traits.marketingOptIn ?? true,
    fbc: "",
    fbp: "",
    consentStatus: "pending",
  };
}

/**
 * POST /webhook
 * Receives Segment webhook events
 */
app.post("/webhook", async (req, res) => {
  const event = req.body as SegmentEvent;

  console.log(
    `[SegmentWebhook] Received ${event.type} event: ${event.messageId}`,
  );

  try {
    if (event.type === "track") {
      const transformed = transformTrackEvent(event);
      console.log(
        `[SegmentWebhook] Transformed track event:`,
        transformed.eventName,
      );

      // Send to Event ingest API
      const response = await fetch("http://localhost:4000/ingest/Event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transformed),
      });
      if (!response.ok) {
        throw new Error(`Ingest API returned ${response.status}`);
      }
      console.log(`[SegmentWebhook] Sent to Event ingest API`);

      res.json({ success: true, type: "track", eventId: transformed.eventId });
    } else if (event.type === "identify") {
      const transformed = transformIdentifyEvent(event);
      console.log(
        `[SegmentWebhook] Transformed identify event for:`,
        transformed.customerId,
      );

      // Send to Customer ingest API
      const response = await fetch("http://localhost:4000/ingest/Customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transformed),
      });
      if (!response.ok) {
        throw new Error(`Ingest API returned ${response.status}`);
      }
      console.log(`[SegmentWebhook] Sent to Customer ingest API`);

      res.json({
        success: true,
        type: "identify",
        customerId: transformed.customerId,
      });
    } else {
      console.log(`[SegmentWebhook] Unsupported event type`);
      res.status(400).json({ error: "Unsupported event type" });
    }
  } catch (error) {
    console.error(`[SegmentWebhook] Error processing event:`, error);
    res.status(500).json({ error: "Failed to process event" });
  }
});

/**
 * GET /webhook/health
 * Health check endpoint
 */
app.get("/webhook/health", (req, res) => {
  res.json({ status: "ok", service: "segment-webhook" });
});

/**
 * Export the WebApp instance
 * Mounted at /segment
 */
export const segmentWebhook = new WebApp("segmentWebhook", app, {
  mountPath: "/segment",
  metadata: {
    description: "Segment webhook receiver for CDP events",
  },
});
