import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
	InstrumentationBase,
	type InstrumentationConfig,
	InstrumentationNodeModuleDefinition,
} from "@opentelemetry/instrumentation";

export class ZlibInstrumentation extends InstrumentationBase {
	constructor(config: InstrumentationConfig = {}) {
		super("zlib-instrumentation", "1.0.0", config);
	}

	protected init(): InstrumentationNodeModuleDefinition[] {
		const moduleDefinition = new InstrumentationNodeModuleDefinition(
			"zlib",
			["*"],
			(moduleExports) => {
				this._diag.debug("Patching zlib module");

				if (moduleExports.createGzip) {
					this._wrap(
						moduleExports,
						"createGzip",
						this._patchCreateGzip.bind(this),
					);
				}

				return moduleExports;
			},
			(moduleExports) => {
				this._diag.debug("Unpatching zlib module");

				if (moduleExports.createGzip) {
					this._unwrap(moduleExports, "createGzip");
				}

				return moduleExports;
			},
		);

		return [moduleDefinition];
	}

	private _patchCreateGzip(original: Function) {
		const instrumentation = this;

		return function patchedCreateGzip(this: any, ...args: any[]) {
			const span = instrumentation.tracer.startSpan("zlib.createGzip", {
				kind: SpanKind.INTERNAL,
			});

			try {
				// Create the gzip stream first
				const gzipStream = original.apply(this, args);

				gzipStream.once("end", () => {
					span.setAttribute("zlib.status", "completed");
					span.setStatus({ code: SpanStatusCode.OK });
					span.end();
				});

				gzipStream.once("error", (error: Error) => {
					span.setAttribute("zlib.status", "error");
					span.setAttribute("zlib.error.message", error.message);
					span.recordException(error);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message,
					});
					span.end();
				});

				return gzipStream;
			} catch (error) {
				span.recordException(error as Error);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: (error as Error).message,
				});
				span.end();
				throw error;
			}
		};
	}
}
