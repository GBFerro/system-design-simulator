import { autoscalePolicySpecs, PARAM } from "../params";
import { defineSchema } from "./define";

/**
 * Autoscaler: control plane that sets `instances` of the nodes it is wired
 * to. It carries no request traffic (its edges are born with
 * `callsPerRequest: 0`), so its core params are tucked away in Advanced.
 */
export const autoscalerSchema = defineSchema(
  "autoscaler",
  "fixed",
  [
    ...autoscalePolicySpecs(),
    {
      key: PARAM.provisioningDelaySec,
      label: "Provisioning delay",
      kind: "duration",
      default: 90,
      min: 0,
      max: 1800,
      step: 5,
      unit: "s",
      group: "latency",
      help: "Boot + warm-up before a new instance takes traffic: containers take seconds, VMs 1–3 minutes. Spikes shorter than this are not absorbed.",
    },
  ],
  {
    instances: { group: "advanced", help: "The control plane itself; not in the request path." },
    capacityPerInstance: { group: "advanced", help: "Not in the request path." },
    serviceTimeMs: { group: "advanced", help: "Not in the request path." },
    availability: { group: "advanced" },
  },
);
