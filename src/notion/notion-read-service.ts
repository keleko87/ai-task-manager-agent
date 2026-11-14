import { z } from "zod";

export const NOTION_PAGE_ID = "411f963e-438f-81d7-ac61-d59994bd83b0" as const;

export const NOTION_PAGE_URL = `https://app.notion.com/p/${NOTION_PAGE_ID.replaceAll("-", "")}`;

const normalizeId = (id: string) => id.replaceAll("-", "").toLowerCase();

export function assertDestination(id: string): void {
  if (normalizeId(id) !== normalizeId(NOTION_PAGE_ID)) {
    throw new Error("Destino de Notion no autorizado.");
  }
}

const PageSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  complete: z.literal(true),
  revision: z.string().min(1),
});

export type WorkoutPage = z.infer<typeof PageSchema>;

/** Host-only transport. It must authenticate, paginate and report incomplete reads honestly. */
export interface NotionReadTransport {
  fetchPage(pageId: typeof NOTION_PAGE_ID): Promise<unknown>;
}

export function createWorkoutReader(transport: NotionReadTransport) {
  return {
    async read(): Promise<WorkoutPage> {
      assertDestination(NOTION_PAGE_ID);

      const page = PageSchema.parse(await transport.fetchPage(NOTION_PAGE_ID));

      assertDestination(page.id);

      if (/<unknown(?:\s|>)/i.test(page.content)) {
        throw new Error("Lectura de Notion incompleta.");
      }

      return { ...page, id: NOTION_PAGE_ID };
    },
  };
}

export type WorkoutReader = ReturnType<typeof createWorkoutReader>;
