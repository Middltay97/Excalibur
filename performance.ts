import { openDB, type IDBPDatabase } from "idb";

export interface QueuedCount {
  id: string; // client uuid
  cycle_id: string;
  item_id: string | null;
  sku: string | null;
  barcode: string | null;
  qty_before: number | null;
  qty_after: number;
  action: "count" | "adjust" | "unexpected";
  user_id: string;
  created_at: string;
  is_unexpected: boolean;
}

const DB_NAME = "cyclecount-offline";
const STORE = "queue";

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueue(item: QueuedCount) {
  const d = await db();
  await d.put(STORE, item);
}

export async function getQueued(): Promise<QueuedCount[]> {
  const d = await db();
  return (await d.getAll(STORE)) as QueuedCount[];
}

export async function dequeue(id: string) {
  const d = await db();
  await d.delete(STORE, id);
}

export async function queueCount(): Promise<number> {
  const d = await db();
  return d.count(STORE);
}
