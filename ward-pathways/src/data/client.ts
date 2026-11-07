import {
  ConnectorsRayfinClient,
  type FunctionsSchema,
} from "@microsoft/rayfin-client";
import type { EntitySchema } from "@microsoft/rayfin-data";
import {
  fabricSemanticModel,
  type SemanticModelQueryResult,
} from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { connectorConfig } from "../../rayfin/connectors/wardmodel/schema.js";
import type { AppConnectorsSchema } from "../../rayfin/connectors/schema.js";

import type { DataRow } from "./shape";
export type { DataRow };

function requiredEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Required app configuration ${name} is missing.`);
  return value;
}

export const fabricOptions = {
  workspaceId: requiredEnv("VITE_FABRIC_WORKSPACE_ID", import.meta.env.VITE_FABRIC_WORKSPACE_ID),
  projectId: requiredEnv("VITE_FABRIC_ITEM_ID", import.meta.env.VITE_FABRIC_ITEM_ID),
  fabricPortalUrl: requiredEnv("VITE_FABRIC_PORTAL_URL", import.meta.env.VITE_FABRIC_PORTAL_URL),
  returnOrigin: window.location.origin,
};

export const client = new ConnectorsRayfinClient<EntitySchema, FunctionsSchema, AppConnectorsSchema>(
  {
    baseUrl: requiredEnv("VITE_RAYFIN_API_URL", import.meta.env.VITE_RAYFIN_API_URL),
    publishableKey: requiredEnv("VITE_RAYFIN_PUBLISHABLE_KEY", import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY),
    connectors: { wardmodel: connectorConfig },
  },
  { wardmodel: fabricSemanticModel() },
);

function toRows(result: SemanticModelQueryResult, label: string): DataRow[] {
  if (result.status === "error") throw new Error(`${label}: ${result.error.message}`);
  const { columns, rows } = result.table;
  // Column names come back as "[name]" or "table[name]"; keep just the name.
  const keys = columns.map((c) => c.name.match(/\[([^\]]+)\]$/)?.[1] ?? c.name);
  return rows.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i]])));
}

/** Run a read-only DAX query against the Ward_Movement semantic model. */
export async function runQuery(query: string, label: string): Promise<DataRow[]> {
  const result = await client.connectors.wardmodel.executeQuery({ query });
  return toRows(result, label);
}
