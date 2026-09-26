import type { ComponentSchema } from "../types";
import { autoscalerSchema } from "./autoscaler";
import { cacheSchema } from "./cache";
import { cdnSchema, originShieldSchema } from "./cdn";
import { circuitBreakerSchema } from "./circuitBreaker";
import { clientSchema } from "./client";
import { dnsSchema } from "./dns";
import { apiGatewaySchema, rateLimiterSchema } from "./gateway";
import { loadBalancerSchema } from "./loadBalancer";
import { nosqlDbSchema } from "./nosqlDb";
import { dlqSchema, messageQueueSchema, pubSubSchema } from "./queue";
import {
  appServerSchema,
  authServiceSchema,
  customSchema,
  notificationServiceSchema,
  streamProcessorSchema,
  taskSchedulerSchema,
  websocketServerSchema,
} from "./service";
import { readReplicaSchema, sqlDbSchema } from "./sqlDb";
import { objectStorageSchema, searchSchema } from "./storage";
import { wafSchema } from "./waf";
import { workerPoolSchema } from "./workerPool";

/**
 * Hand-written schemas (Spec 03, CMP-01). Catalog ids not listed here
 * (service mesh, monitoring, graph DB, …) use the generic fixed-capacity
 * schema from `genericSchema`.
 */
export const CATALOG_SCHEMAS: readonly ComponentSchema[] = [
  clientSchema,
  dnsSchema,
  cdnSchema,
  originShieldSchema,
  loadBalancerSchema,
  apiGatewaySchema,
  rateLimiterSchema,
  wafSchema,
  appServerSchema,
  authServiceSchema,
  websocketServerSchema,
  notificationServiceSchema,
  taskSchedulerSchema,
  streamProcessorSchema,
  customSchema,
  workerPoolSchema,
  cacheSchema,
  sqlDbSchema,
  readReplicaSchema,
  nosqlDbSchema,
  objectStorageSchema,
  searchSchema,
  messageQueueSchema,
  pubSubSchema,
  dlqSchema,
  circuitBreakerSchema,
  autoscalerSchema,
];
