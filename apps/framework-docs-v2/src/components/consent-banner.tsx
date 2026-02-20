"use client";

import { useState } from "react";
import { useConsent } from "@/lib/consent-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

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
      <CardHeader className="p-0">
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
      </CardHeader>

      <CardContent className="flex flex-col p-0">
        <div className="flex items-center justify-between py-2.5">
          <Label htmlFor="analytics-toggle" className="text-base font-medium">
            Analytics
          </Label>
          <Switch
            id="analytics-toggle"
            checked={analyticsEnabled}
            onCheckedChange={setAnalyticsEnabled}
          />
        </div>
        <div className="flex items-center justify-between py-2.5">
          <Label htmlFor="marketing-toggle" className="text-base font-medium">
            Marketing
          </Label>
          <Switch
            id="marketing-toggle"
            checked={marketingEnabled}
            onCheckedChange={setMarketingEnabled}
          />
        </div>
      </CardContent>

      <CardFooter className="gap-2 p-0 pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button className="ml-auto" onClick={onSave}>
          Save Preferences
        </Button>
      </CardFooter>
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
      <CardHeader className="p-0">
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
      </CardHeader>

      <CardFooter className="gap-2 p-0 pt-2">
        <Button variant="secondary" onClick={onRejectAll}>
          Reject All
        </Button>
        <Button variant="secondary" onClick={onCustomize}>
          Customize
        </Button>
        <Button className="ml-auto" onClick={onAcceptAll}>
          Accept All
        </Button>
      </CardFooter>
    </>
  );
}

export function ConsentBanner() {
  const { hasConsented, acceptAll, rejectAll, savePreferences } = useConsent();
  const [view, setView] = useState<"banner" | "customize">("banner");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [marketingEnabled, setMarketingEnabled] = useState(false);

  if (hasConsented) return null;

  return (
    <Card
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-6 z-[9999] flex flex-col gap-4 p-5 shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-w-lg"
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
    </Card>
  );
}
