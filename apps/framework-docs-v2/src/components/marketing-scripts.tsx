"use client";

import { useConsent } from "@/lib/consent-context";
import { Apollo } from "@/components/apollo";
import { CommonRoom } from "@/components/common-room";

export function MarketingScripts() {
  const { marketingAllowed } = useConsent();

  if (!marketingAllowed) return null;

  return (
    <>
      <Apollo />
      <CommonRoom />
    </>
  );
}
