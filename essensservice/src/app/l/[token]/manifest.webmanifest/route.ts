import { notFound } from "next/navigation";
import { TOKEN_PATTERN, personalManifest } from "@/lib/server/manifest";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN_PATTERN.test(token)) notFound();
  return personalManifest(`/l/${token}`, "Agrarlohn Auslieferung", "Auslieferung");
}
