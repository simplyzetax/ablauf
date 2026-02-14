// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"api-reference.mdx": () => import("../content/docs/api-reference.mdx?collection=docs"), "events.mdx": () => import("../content/docs/events.mdx?collection=docs"), "getting-started.mdx": () => import("../content/docs/getting-started.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "lifecycle.mdx": () => import("../content/docs/lifecycle.mdx?collection=docs"), "observability.mdx": () => import("../content/docs/observability.mdx?collection=docs"), "retries.mdx": () => import("../content/docs/retries.mdx?collection=docs"), "sse.mdx": () => import("../content/docs/sse.mdx?collection=docs"), "steps/do.mdx": () => import("../content/docs/steps/do.mdx?collection=docs"), "steps/sleep.mdx": () => import("../content/docs/steps/sleep.mdx?collection=docs"), "steps/wait-for-event.mdx": () => import("../content/docs/steps/wait-for-event.mdx?collection=docs"), "workflows/class-based.mdx": () => import("../content/docs/workflows/class-based.mdx?collection=docs"), "workflows/functional.mdx": () => import("../content/docs/workflows/functional.mdx?collection=docs"), }),
};
export default browserCollections;