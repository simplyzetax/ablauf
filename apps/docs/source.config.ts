import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import {
	remarkAutoTypeTable,
	createGenerator,
	createFileSystemGeneratorCache,
} from "fumadocs-typescript";

const generator = createGenerator({
	tsconfigPath: "../../packages/workflows/tsconfig.json",
	cache: createFileSystemGeneratorCache(".next/fumadocs-typescript"),
});

export const docs = defineDocs({
	dir: "content/docs",
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: [[remarkAutoTypeTable, { generator }]],
	},
});
