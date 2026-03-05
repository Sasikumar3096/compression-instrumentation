import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { context, trace, SpanStatusCode, ROOT_CONTEXT, Span, SpanKind, Tracer } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ZlibInstrumentation } from '../src';
import * as assert from 'assert';

// Import zlib AFTER setting up instrumentation
let zlib: any;

const TEST_DATA = Buffer.from('test data for compression');

function runGzipStream(gzip: any): Promise<void> {
  return new Promise((resolve, reject) => {
    gzip.on('data', () => {});
    gzip.on('end', resolve);
    gzip.on('error', reject);
    gzip.write(TEST_DATA);
    gzip.end();
  });
}

function getSpan(exporter: InMemorySpanExporter): ReadableSpan {
  const spans = exporter.getFinishedSpans();
  assert.ok(spans.length > 0, 'No spans were created');
  return spans[0];
}

function validateSpan(
  span: ReadableSpan,
  options: { status: 'completed' | 'error'; errorMessage?: string },
) {
  assert.strictEqual(span.name, 'zlib.createGzip');
  assert.strictEqual(span.kind, SpanKind.INTERNAL);
  assert.strictEqual(span.attributes['zlib.status'], options.status);

  if (options.errorMessage) {
    assert.strictEqual(span.attributes['zlib.error.message'], options.errorMessage);
    assert.strictEqual(span.status.code, SpanStatusCode.ERROR);
    assert.strictEqual(span.status.message, options.errorMessage);
    const events = span.events.filter((e) => e.name === 'exception');
    assert.strictEqual(events.length, 1);
  } else {
    assert.strictEqual(span.status.code, SpanStatusCode.OK);
  }
}

describe('ZlibInstrumentation', () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let tracer: Tracer;
  let contextManager: AsyncLocalStorageContextManager;
  let instrumentation: ZlibInstrumentation;
  let rootSpan: Span;

  before(function () {
    contextManager = new AsyncLocalStorageContextManager();
    context.setGlobalContextManager(contextManager);

    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();

    instrumentation = new ZlibInstrumentation({ enabled: true });
    instrumentation.enable();

    zlib = require('zlib');
    tracer = provider.getTracer('test-tracer');
  });

  after(function () {
    instrumentation?.disable();
    provider?.shutdown();
    contextManager?.disable();
  });

  beforeEach(function () {
    exporter.reset();
    rootSpan = tracer.startSpan('root');
  });

  afterEach(function () {
    rootSpan.end();
  });

  describe('Gzip Operations', () => {
    it('creates a span on successful compression', async function () {
      await context.with(trace.setSpan(context.active(), rootSpan), () =>
        runGzipStream(zlib.createGzip()),
      );

      validateSpan(getSpan(exporter), { status: 'completed' });
    });

    it('creates a span without an active context', async function () {
      await context.with(ROOT_CONTEXT, () => runGzipStream(zlib.createGzip()));

      validateSpan(getSpan(exporter), { status: 'completed' });
    });
  });

  describe('Error Handling', () => {
    it('records stream errors on the span', function (done) {
      context.with(trace.setSpan(context.active(), rootSpan), () => {
        const gzip = zlib.createGzip();

        gzip.on('error', (error: any) => {
          try {
            validateSpan(getSpan(exporter), { status: 'error', errorMessage: error.message });
            done();
          } catch (err) {
            done(err);
          }
        });

        gzip.write(TEST_DATA);
        gzip.destroy(new Error('Test error'));
      });
    });
  });

  describe('Context Handling', () => {
    it('propagates trace context through async operations', async function () {
      let contextChecked = false;

      await context.with(trace.setSpan(context.active(), rootSpan), () => {
        const gzip = zlib.createGzip();

        gzip.on('data', () => {
          const currentSpan = trace.getSpan(context.active());
          assert.ok(currentSpan, 'Should have active span in data event');
          assert.strictEqual(
            currentSpan.spanContext().traceId,
            rootSpan.spanContext().traceId,
            'Should maintain trace context',
          );
          contextChecked = true;
        });

        return runGzipStream(gzip);
      });

      assert.ok(contextChecked, 'Should have checked context in data event');
      validateSpan(getSpan(exporter), { status: 'completed' });
    });
  });
});
