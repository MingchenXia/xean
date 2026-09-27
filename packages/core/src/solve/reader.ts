import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { object, type Note } from "./contracts.ts";
import { noteInfo } from "./notes.ts";

const readSchema = object({
  ids: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
  }),
  level: StringEnum(["detailed", "full"] as const),
});

/** Read from the caller's detached, frozen invocation snapshot. */
export function noteReader(notes: Note[]): AgentTool<typeof readSchema> {
  return {
    name: "read_notes",
    label: "Read notes",
    description:
      "Read detailed summaries or authoritative full notes by ID from the supplied index, with status and feedback. Batch up to 20 IDs. Dead notes are diagnostic only. Full notes retain support IDs for further reads.",
    parameters: readSchema,
    async execute(_id, { ids, level }) {
      const values = ids.map((id) => {
        const note = notes.find((note) => note.id === id);
        if (!note) throw new Error(`Unknown note: ${id}`);
        return {
          ...noteInfo(note),
          detailedSummary: note.detailedSummary,
          ...(level === "full" ? { text: note.text } : {}),
        };
      });
      return {
        content: [{ type: "text", text: JSON.stringify(values) }],
        details: null,
      };
    },
  };
}
