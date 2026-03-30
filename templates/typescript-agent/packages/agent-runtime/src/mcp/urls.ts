const MCP_ENDPOINT_PATH = "/tools";

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

function formatUrl(url: URL): string {
  if (url.pathname === "/" && !url.search && !url.hash) {
    return url.origin;
  }

  return url.toString().replace(/\/$/, "");
}

export function resolveMcpServerUrl(value: string): string {
  const url = new URL(value);
  const pathname = normalizePathname(url.pathname);

  if (pathname === "/") {
    url.pathname = MCP_ENDPOINT_PATH;
    return formatUrl(url);
  }

  url.pathname =
    pathname.endsWith(MCP_ENDPOINT_PATH) ? pathname : (
      `${pathname}${MCP_ENDPOINT_PATH}`
    );

  return formatUrl(url);
}
