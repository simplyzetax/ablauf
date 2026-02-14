import { source } from "@/lib/source";
import { notFound } from "next/navigation";

export async function GET(
	_req: Request,
	props: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await props.params;
	const page = source.getPage(slug);
	if (!page || page.data.type === "openapi") notFound();

	const text = await page.data.getText("processed");
	const content = `# ${page.data.title}\n\n${text}`;

	return new Response(content, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
