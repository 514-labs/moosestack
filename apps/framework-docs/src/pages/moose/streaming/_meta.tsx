import { render } from "@/components";

const rawMeta = {
  "---Managing Streams---": {
    title: "Managing Streams",
    type: "separator",
  },
  "create-stream": {
    title: "Creating Streams",
  },
  "sync-to-table": {
    title: "Syncing Streams to Tables",
  },
  "dead-letter-queues": {
    title: "Configuring Dead Letter Queues",
  },
  "---Functions---": {
    title: "Functions",
    type: "separator",
  },
  "consumer-functions": {
    title: "Consumer Functions",
  },
  "transform-functions": {
    title: "Transformation Functions",
  },
  "---Producing---": {
    title: "Writing to Streams",
    type: "separator",
  },
  "from-your-code": {
    title: "From Your Code",
  },
  "connect-cdc": {
    title: "From CDC Services",
    display: "hidden",
  },
};

export default render(rawMeta);
