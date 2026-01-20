import Script from "next/script";

declare global {
  interface Window {
    trackingFunctions?: {
      onLoad: (config: { appId: string }) => void;
    };
  }
}

export function Apollo() {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  return (
    <Script
      id="apollo-init"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
(function initApollo() {
  var n = Math.random().toString(36).substring(7);
  var o = document.createElement("script");
  o.src = "https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache=" + n;
  o.async = true;
  o.defer = true;
  o.onload = function() {
    window.trackingFunctions.onLoad({ appId: "66316b76c8e6ae01afde8c2d" });
  };
  document.head.appendChild(o);
})();
        `.trim(),
      }}
    />
  );
}
