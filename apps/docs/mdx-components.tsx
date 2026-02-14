import defaultComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { createGenerator, createFileSystemGeneratorCache } from 'fumadocs-typescript';
import { AutoTypeTable } from 'fumadocs-typescript/ui';

const generator = createGenerator({
	tsconfigPath: '../../packages/workflows/tsconfig.json',
	cache: createFileSystemGeneratorCache('.next/fumadocs-typescript'),
});

export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultComponents,
		AutoTypeTable: (props) => <AutoTypeTable {...props} generator={generator} />,
		...components,
	};
}
