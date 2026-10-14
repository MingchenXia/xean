import { Type, type Static } from "@earendil-works/pi-ai";
import {
  decode,
  noteDraftSchema,
  noteEditSchema,
  object,
} from "./contracts.ts";

const id = Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" });
const text = Type.String({ minLength: 1, pattern: "\\S" });
const trusted = Type.Optional(Type.Boolean());
export const commandSchema = Type.Union([
  object({
    kind: Type.Literal("submit"),
    id,
    notes: Type.Array(object({ ...noteDraftSchema.properties, trusted })),
    edits: Type.Optional(
      Type.Array(object({ ...noteEditSchema.properties, trusted })),
    ),
  }),
  object({ kind: Type.Literal("guide"), id, text }),
  object({
    kind: Type.Literal("recheck"),
    id,
    notes: Type.Array(Type.Pick(noteEditSchema, ["id", "revision"]), {
      minItems: 1,
    }),
    reason: text,
  }),
]);
export type SolverCommand = Static<typeof commandSchema>;
/** Match Pi's stored JSON, including omitted optional undefined fields. */
export const readCommand = (value: unknown): SolverCommand =>
  JSON.parse(JSON.stringify(decode(commandSchema, value)));
