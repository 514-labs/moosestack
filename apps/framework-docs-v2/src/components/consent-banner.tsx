"use client";

import { useState } from "react";
import { useConsent } from "@/lib/consent-context";

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${checked ? "bg-neutral-900 dark:bg-white" : "bg-neutral-300 dark:bg-neutral-600"}`}
    >
      <span
        className={`pointer-events-none block size-5 rounded-full shadow-md transition-transform ${
          checked ?
            "translate-x-5 bg-white dark:bg-neutral-900"
          : "translate-x-0.5 bg-neutral-900 dark:bg-white"
        }`}
      />
    </button>
  );
}

function CustomizeView({
  analyticsEnabled,
  setAnalyticsEnabled,
  onSave,
  onBack,
}: {
  analyticsEnabled: boolean;
  setAnalyticsEnabled: (v: boolean) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const categories = [
    {
      name: "Strictly Needed",
      enabled: true,
      locked: true,
    },
    {
      name: "Analytics",
      enabled: analyticsEnabled,
      locked: false,
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-7 text-neutral-900 dark:text-white">
          Cookie Preferences
        </h2>
        <p className="text-sm leading-5 text-neutral-500 dark:text-neutral-400">
          This website uses the following services.{" "}
          <a
            href="https://fiveonefour.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-neutral-900 dark:hover:text-white"
          >
            Learn more
          </a>
        </p>
      </div>

      <div className="flex flex-col">
        {categories.map((cat) => (
          <div
            key={cat.name}
            className="flex items-center justify-between py-2.5"
          >
            <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white">
              {cat.name}
            </span>
            <Toggle
              checked={cat.enabled}
              onChange={(v) => {
                if (cat.name === "Analytics") setAnalyticsEnabled(v);
              }}
              disabled={cat.locked}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-6">
        <button
          onClick={onBack}
          className="flex h-10 flex-1 items-center justify-center rounded-md border border-neutral-300 bg-neutral-100 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700"
        >
          Back
        </button>
        <button
          onClick={onSave}
          className="flex h-10 flex-1 items-center justify-center rounded-md bg-neutral-900 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Save Preferences
        </button>
      </div>
    </>
  );
}

function BannerView({
  onCustomize,
  onAcceptAll,
}: {
  onCustomize: () => void;
  onAcceptAll: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-7 text-neutral-900 dark:text-white">
          We value your privacy
        </h2>
        <p className="text-sm leading-5 text-neutral-500 dark:text-neutral-400">
          Our site uses, and allows third parties to use, cookies and other
          tracking technologies to enable and improve site functionality,
          analyze site use, generate user and site analytics, and facilitate
          advertising. As explained in our{" "}
          <a
            href="https://fiveonefour.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-900 underline dark:text-white"
          >
            Privacy Policy
          </a>
          , we may transfer data to third parties through use of these tracking
          technologies. By clicking &ldquo;accept all&rdquo; you agree to our
          cookie use.
        </p>
      </div>

      <div className="flex gap-6">
        <button
          onClick={onCustomize}
          className="flex h-10 flex-1 items-center justify-center rounded-md border border-neutral-300 bg-neutral-100 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700"
        >
          Customize
        </button>
        <button
          onClick={onAcceptAll}
          className="flex h-10 flex-1 items-center justify-center rounded-md bg-neutral-900 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Accept All
        </button>
      </div>
    </>
  );
}

export function ConsentBanner() {
  const { hasConsented, acceptAll, savePreferences } = useConsent();
  const [view, setView] = useState<"banner" | "customize">("banner");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);

  if (hasConsented) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 right-4 z-[9999] flex w-full max-w-lg flex-col gap-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
    >
      {view === "banner" ?
        <BannerView
          onCustomize={() => setView("customize")}
          onAcceptAll={acceptAll}
        />
      : <CustomizeView
          analyticsEnabled={analyticsEnabled}
          setAnalyticsEnabled={setAnalyticsEnabled}
          onSave={() => savePreferences({ analytics: analyticsEnabled })}
          onBack={() => setView("banner")}
        />
      }
    </div>
  );
}
