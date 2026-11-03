import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TOKEN_PATTERN } from "@/lib/server/manifest";
import DriverApp from "./DriverApp";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return { title: "Mein Essen", manifest: `/f/${token}/manifest.webmanifest` };
}

export default async function DriverPage({ params }: Props) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) notFound();
  return <DriverApp token={token} />;
}
