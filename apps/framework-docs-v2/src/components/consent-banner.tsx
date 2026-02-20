"use client";

import { useState } from "react";
import { useConsent } from "@/lib/consent-context";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
        checked ? "bg-primary" : "bg-input"
      }`}
    >
      <span
        className={`pointer-events-none block size-5 rounded-full bg-background shadow-md transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function CustomizeView({
  analyticsEnabled,
  setAnalyticsEnabled,
  marketingEnabled,
  setMarketingEnabled,
  onSave,
  onBack,
}: {
  analyticsEnabled: boolean;
  setAnalyticsEnabled: (v: boolean) => void;
  marketingEnabled: boolean;
  setMarketingEnabled: (v: boolean) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-7">Cookie Preferences</h2>
        <p className="text-sm leading-5 text-muted-foreground">
          This website uses the following services.{" "}
          <a
            href="https://www.fiveonefour.com/legal/privacy.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Learn more
          </a>
        </p>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between py-2.5">
          <span className="text-base font-medium">Analytics</span>
          <Toggle checked={analyticsEnabled} onChange={setAnalyticsEnabled} />
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-base font-medium">Marketing</span>
          <Toggle checked={marketingEnabled} onChange={setMarketingEnabled} />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={onBack}
          className="h-9 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Back
        </button>
        <button
          onClick={onSave}
          className="ml-auto h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Save Preferences
        </button>
      </div>
    </>
  );
}

function BannerView({
  onRejectAll,
  onCustomize,
  onAcceptAll,
}: {
  onRejectAll: () => void;
  onCustomize: () => void;
  onAcceptAll: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-7">
          We value your privacy
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">
          This site uses cookies to improve your browsing experience, analyze
          site traffic, and show personalized content. See our{" "}
          <a
            href="https://www.fiveonefour.com/legal/privacy.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={onRejectAll}
          className="h-9 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Reject All
        </button>
        <button
          onClick={onCustomize}
          className="h-9 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Customize
        </button>
        <button
          onClick={onAcceptAll}
          className="ml-auto h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Accept All
        </button>
      </div>
    </>
  );
}

export function ConsentBanner() {
  const { hasConsented, acceptAll, rejectAll, savePreferences } = useConsent();
  const [view, setView] = useState<"banner" | "customize">("banner");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [marketingEnabled, setMarketingEnabled] = useState(true);

  if (hasConsented) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-6 z-[9999] flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-w-lg"
    >
      {view === "banner" ?
        <BannerView
          onRejectAll={rejectAll}
          onCustomize={() => setView("customize")}
          onAcceptAll={acceptAll}
        />
      : <CustomizeView
          analyticsEnabled={analyticsEnabled}
          setAnalyticsEnabled={setAnalyticsEnabled}
          marketingEnabled={marketingEnabled}
          setMarketingEnabled={setMarketingEnabled}
          onSave={() =>
            savePreferences({
              analytics: analyticsEnabled,
              marketing: marketingEnabled,
            })
          }
          onBack={() => setView("banner")}
        />
      }
    </div>
  );
}
