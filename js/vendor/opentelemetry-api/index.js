/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
export { baggageEntryMetadataFromString } from './baggage/utils.js';
// Context APIs
export { createContextKey, ROOT_CONTEXT } from './context/context.js';
// Diag APIs
export { DiagConsoleLogger } from './diag/consoleLogger.js';
export { DiagLogLevel } from './diag/types.js';
// Metrics APIs
export { createNoopMeter } from './metrics/NoopMeter.js';
export { ValueType } from './metrics/Metric.js';
// Propagation APIs
export { defaultTextMapGetter, defaultTextMapSetter, } from './propagation/TextMapPropagator.js';
export { ProxyTracer } from './trace/ProxyTracer.js';
// TODO: Remove ProxyTracerProvider export in the next major version.
export { ProxyTracerProvider } from './trace/ProxyTracerProvider.js';
export { SamplingDecision } from './trace/SamplingResult.js';
export { SpanKind } from './trace/span_kind.js';
export { SpanStatusCode } from './trace/status.js';
export { TraceFlags } from './trace/trace_flags.js';
export { createTraceState } from './trace/internal/utils.js';
export { isSpanContextValid, isValidTraceId, isValidSpanId, } from './trace/spancontext-utils.js';
export { INVALID_SPANID, INVALID_TRACEID, INVALID_SPAN_CONTEXT, } from './trace/invalid-span-constants.js';
// Split module-level variable definition into separate files to allow
// tree-shaking on each api instance.
import { context } from './context-api.js';
import { diag } from './diag-api.js';
import { metrics } from './metrics-api.js';
import { propagation } from './propagation-api.js';
import { trace } from './trace-api.js';
// Named export.
export { context, diag, metrics, propagation, trace };
// Default export.
export default {
    context,
    diag,
    metrics,
    propagation,
    trace,
};
//# sourceMappingURL=index.js.map