import Script from "next/script";

declare global {
  interface Window {
    signals?: Array<[string, unknown[]]> & {
      page: (...args: unknown[]) => Window["signals"];
      identify: (...args: unknown[]) => Window["signals"];
      form: (...args: unknown[]) => Window["signals"];
      push: (args: [string, unknown[]]) => void;
      _opts?: {
        apiHost: string;
      };
    };
  }
}

export function CommonRoom() {
  return (
    <>
      <Script
        id="common-room-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  if (typeof window === 'undefined') return;
  if (typeof window.signals !== 'undefined') return;
  var script = document.createElement('script');
  script.src = 'https://cdn.cr-relay.com/v1/site/cc378f74-2e8c-47bc-84a8-79a14bf585de/signals.js';
  script.async = true;
  window.signals = Object.assign(
    [],
    { _opts: { apiHost: 'https://api.cr-relay.com' } },
    ['page', 'identify', 'form'].reduce(function (acc, method){
      acc[method] = function () {
        signals.push([method, arguments]);
        return signals;
      };
     return acc;
    }, {})
  );
  document.head.appendChild(script);
})();
          `.trim(),
        }}
      />
    </>
  );
}
