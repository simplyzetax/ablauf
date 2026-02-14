import { docs } from "@/.source/server";
import { loader, multiple } from "fumadocs-core/source";
import { openapiPlugin, openapiSource } from "fumadocs-openapi/server";
import { openapi } from "@/lib/openapi";

export const source = loader(
	multiple({
		docs: docs.toFumadocsSource(),
		openapi: await openapiSource(openapi, {
			baseDir: "dashboard",
		}),
	}),
	{
		baseUrl: "/docs",
		plugins: [openapiPlugin()],
	},
);
