# @sasikumart/compression-instrumentation
OpenTelemetry instrumentation for Node.js `zlib` that measures gzip compression latency in Express compression middleware pipelines.

## Why

The Express [`compression`](https://www.npmjs.com/package/compression) middleware uses `zlib.createGzip` internally, but provides no built-in observability. In production it is hard to answer:

- How much latency does gzip add to API responses?
- Are large payloads causing disproportionate compression overhead?
- Is a spike in response time caused by compression or application logic?

This library patches `zlib.createGzip` to emit an OpenTelemetry span for every compression operation, so compression latency is visible in your distributed traces alongside the rest of the request lifecycle.

## Installation

```bash
npm install @sasikumart/compression-instrumentation
```

## Usage

Register the instrumentation **before** importing `express` or `compression`.

```ts
import { ZlibInstrumentation } from '@sasikumart/compression-instrumentation';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const provider = new NodeTracerProvider();
provider.register();

const instrumentation = new ZlibInstrumentation({ enabled: true });
instrumentation.enable();

// Import express and compression only after instrumentation is set up
import express from 'express';
import compression from 'compression';

const app = express();
app.use(compression());
```

## Spans

Each `zlib.createGzip` call produces a span named `zlib.createGzip` with kind `INTERNAL`.

| Attribute | Type | Description |
|---|---|---|
| `zlib.status` | `string` | `"completed"` on success, `"error"` on failure |
| `zlib.error.message` | `string` | Error message (only present on failure) |

On error, an `exception` event is also recorded on the span and the span status is set to `ERROR`.

## Requirements

- Node.js 14+
- `@opentelemetry/api` ^1.9.0

## Development

```bash
npm install
npm test        # run tests with mocha
npm run build   # compile TypeScript to dist/
npm run lint    # lint with Biome
```

## License

MIT — [SasiKumar Thangavel](https://github.com/Sasikumar3096)
