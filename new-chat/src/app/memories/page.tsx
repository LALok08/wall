import { db } from "@/db";
import { memories } from "@/db/schema";
import { desc } from "drizzle-orm";
import { MemoryBoardClient } from "./MemoryBoardClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "KMK Campus Memory Board",
  description: "Browse memories and stories from the KMK campus community.",
};

async function getMemories() {
  try {
    const rows = await db.select().from(memories).orderBy(desc(memories.createdAt)).limit(500);
    return rows;
  } catch {
    return [];
  }
}

export default async function MemoriesPage() {
  const initialMemories = await getMemories();
  return <MemoryBoardClient initialMemories={initialMemories} />;
}
