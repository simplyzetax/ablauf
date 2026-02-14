// @ts-nocheck
import * as __fd_glob_15 from "../content/docs/workflows/functional.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/workflows/class-based.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/steps/wait-for-event.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/steps/sleep.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/steps/do.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/sse.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/retries.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/observability.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/lifecycle.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/getting-started.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/events.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/api-reference.mdx?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/workflows/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/steps/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "steps/meta.json": __fd_glob_1, "workflows/meta.json": __fd_glob_2, }, {"api-reference.mdx": __fd_glob_3, "events.mdx": __fd_glob_4, "getting-started.mdx": __fd_glob_5, "index.mdx": __fd_glob_6, "lifecycle.mdx": __fd_glob_7, "observability.mdx": __fd_glob_8, "retries.mdx": __fd_glob_9, "sse.mdx": __fd_glob_10, "steps/do.mdx": __fd_glob_11, "steps/sleep.mdx": __fd_glob_12, "steps/wait-for-event.mdx": __fd_glob_13, "workflows/class-based.mdx": __fd_glob_14, "workflows/functional.mdx": __fd_glob_15, });