import { getProviderData, createFlagsDiscoveryEndpoint } from "flags/next";
import * as flags from "../../../../flags";

/**
 * Vercel Toolbar Flags Explorer endpoint
 *
 * This endpoint exposes feature flag definitions to the Vercel Toolbar
 * so they can be viewed and overridden in the Flags Explorer.
 *
 * Documentation: https://vercel.com/docs/feature-flags/implement-flags-in-toolbar
 */
export const GET = createFlagsDiscoveryEndpoint(() => getProviderData(flags));
