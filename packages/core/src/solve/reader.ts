import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import type { AgentContext } from "@earendil-works/pi-agent-core";
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
const findSchema = object({
  query: Type.String({ maxLength: 200 }),
  offset: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 1, maximum: 50 }),
});
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: null,
});

/** Readers share the caller's detached, frozen invocation snapshot. */
export function noteTools(notes: Note[]): AgentContext["tools"] {
  return [
    {
      name: "read_notes",
      label: "Read notes",
      description:
        "Read detailed summaries or authoritative full notes from the frozen snapshot, with status and feedback. Batch up to 20 IDs. Dead notes are diagnostic only. Full notes retain support IDs for further reads.",
      parameters: readSchema,
      async execute(_id, args) {
        const { ids, level } = args as Static<typeof readSchema>;
        return result(
          ids.map((id) => {
            const note = notes.find((note) => note.id === id);
            if (!note) throw new Error(`Unknown note: ${id}`);
            return {
              ...noteInfo(note),
              detailedSummary: note.detailedSummary,
              ...(level === "full" ? { text: note.text } : {}),
            };
          }),
        );
      },
    },
    {
      name: "find_notes",
      label: "Find notes",
      description:
        "Find notes by case-insensitive literal substring across IDs, summaries, and full text. Empty query lists all notes. Returns index summaries, status, and feedback in snapshot order, with nextOffset for another page. At most 50 matches per call.",
      parameters: findSchema,
      async execute(_id, args) {
        const { query, offset, limit } = args as Static<typeof findSchema>;
        const needle = query.toLowerCase();
        const matches = notes.filter((note) =>
          [note.id, note.summary, note.detailedSummary, note.text].some(
            (value) => value.toLowerCase().includes(needle),
          ),
        );
        return result({
          notes: matches.slice(offset, offset + limit).map(noteInfo),
          nextOffset: offset + limit < matches.length ? offset + limit : null,
        });
      },
    },
  ];
}
