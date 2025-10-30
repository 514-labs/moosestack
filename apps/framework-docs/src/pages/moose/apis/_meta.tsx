import { render } from "@/components";

const rawMeta = {
  auth: {
    title: "Auth",
  },
  "ingest-api": {
    title: "Ingest New Data",
  },
  "analytics-api": {
    title: "Expose Analytics",
  },
  "trigger-api": {
    title: "Trigger Workflows",
  },
  __client__: {
    type: "separator",
    title: "Client Libraries",
  },
  "openapi-sdk": {
    title: "OpenAPI SDK",
  },
  "bring-your-own-api-framework": {
    title: "Bring Your Own API Framework",
  },
  "admin-api": {
    title: "Admin APIs",
    display: "hidden",
  },
};

export default render(rawMeta);
