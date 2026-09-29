import { PARAM } from "../params";
import { defineSchema } from "./define";

/** Client / Traffic Source: explicit entry point that generates the arrivals. */
export const clientSchema = defineSchema(
  "client",
  "service",
  [
    {
      key: PARAM.baseRps,
      label: "Base load",
      kind: "number",
      default: 1000,
      min: 1,
      max: 10_000_000,
      step: 100,
      unit: "rps",
      group: "capacity",
      help: "Average arrivals per second (Poisson) before the load pattern is applied.",
    },
    {
      key: PARAM.loadPattern,
      label: "Load pattern",
      kind: "enum",
      default: "constant",
      options: [
        { value: "constant", label: "Constant" },
        { value: "diurnal", label: "Diurnal (daily cycle)" },
        { value: "ramp", label: "Ramp up" },
        { value: "spike", label: "Spike" },
      ],
      group: "capacity",
      help: "How the load changes over simulated time.",
    },
    {
      key: PARAM.readRatio,
      label: "Read ratio",
      kind: "percent",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
      group: "capacity",
      help: "Share of requests that are reads; `reads` edges get this share, `writes` edges the rest.",
    },
  ],
  {
    instances: { group: "advanced", help: "Client fleets are modeled as one source." },
    capacityPerInstance: {
      group: "advanced",
      help: "Clients are not a bottleneck; keep this far above the base load.",
    },
    serviceTimeMs: { group: "advanced", help: "Client-side overhead added to every request." },
    availability: { group: "advanced" },
  },
);
