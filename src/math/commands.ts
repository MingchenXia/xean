import { Type, type Static } from "@earendil-works/pi-ai";
import { decode, explorationSchema, object } from "./contracts.ts";

const id = Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" });
const text = Type.String({ minLength: 1, pattern: "\\S" });
export const commandSchema = Type.Union([
  object({
    kind: Type.Literal("submit"),
    id,
    ...explorationSchema.properties,
  }),
  object({ kind: Type.Literal("guide"), id, text }),
]);
export type SolverCommand = Static<typeof commandSchema>;
/** Match Pi's stored JSON, including omitted optional undefined fields. */
export const readCommand = (value: unknown): SolverCommand =>
  JSON.parse(JSON.stringify(decode(commandSchema, value)));
