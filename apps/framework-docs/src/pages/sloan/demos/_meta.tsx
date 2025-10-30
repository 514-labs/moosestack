import { render } from "@/components";

const meta = {
  ingest: {
    title: "Ingest",
    display: "hidden",
  },
  "model-data": {
    title: "Model Data",
    display: "hidden",
  },
  mvs: {
    title: "Materialized Views",
    display: "hidden",
  },
  dlqs: {
    title: "Dead Letter Queues",
    display: "hidden",
  },
  egress: {
    title: "Egress",
    display: "hidden",
  },
};

export default render(meta);
