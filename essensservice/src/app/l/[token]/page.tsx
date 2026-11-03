import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TOKEN_PATTERN } from "@/lib/server/manifest";
import CourierApp from "./CourierApp";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return { title: "Auslieferung", manifest: `/l/${token}/manifest.webmanifest` };
}

export default async function CourierPage({ params }: Props) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) notFound();
  return <CourierApp token={token} />;
}
