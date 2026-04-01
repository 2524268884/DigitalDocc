// source.config.ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import { remarkStructure } from "fumadocs-core/mdx-plugins";
var docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true
    }
  }
});
var source_config_default = defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkStructure]
  }
});
export {
  source_config_default as default,
  docs
};
