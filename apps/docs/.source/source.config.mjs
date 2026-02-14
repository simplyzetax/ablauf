// source.config.ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import {
  remarkAutoTypeTable,
  createGenerator,
  createFileSystemGeneratorCache
} from "fumadocs-typescript";
var generator = createGenerator({
  tsconfigPath: "../../packages/workflows/tsconfig.json",
  cache: createFileSystemGeneratorCache(".next/fumadocs-typescript")
});
var docs = defineDocs({
  dir: "content/docs"
});
var source_config_default = defineConfig({
  mdxOptions: {
    remarkPlugins: [[remarkAutoTypeTable, { generator }]]
  }
});
export {
  source_config_default as default,
  docs
};
