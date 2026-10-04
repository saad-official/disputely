import "server-only";
import * as libraryRepo from "@/lib/db/repositories/library";
import type { LibraryItemInput } from "@/lib/db/repositories/library";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { LibraryItem, Organization } from "@/lib/db/types";
import { asInvalidInput, NotFoundError } from "./errors";
import { assertLibraryWrite } from "./plan-limits";
import { audit } from "./shared";

/**
 * Policy library (spec 3.3): refund and cancellation policies, where the
 * customer saw them (disclosures), terms, shipping policy and product
 * descriptions. The assembler picks the newest item of each kind, preferring
 * the dispute's product line. Saving is Pro; deleting is always allowed.
 * Existing packets pick changes up the next time they are rebuilt.
 */

export type { LibraryItemInput };

async function loadOrg(orgId: string): Promise<Organization> {
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");
  return org;
}

export async function createItem(orgId: string, input: LibraryItemInput): Promise<LibraryItem> {
  const org = await loadOrg(orgId);
  assertLibraryWrite(org, { productLine: input.productLine });
  const item = await asInvalidInput(() => libraryRepo.create(orgId, input));
  await audit({
    orgId,
    actor: "user",
    type: "library.created",
    entityType: "library_item",
    entityId: item.id,
    input: { kind: item.kind, title: item.title, productLine: item.productLine },
  });
  return item;
}

export async function updateItem(orgId: string, itemId: string, patch: Partial<LibraryItemInput>): Promise<LibraryItem> {
  const org = await loadOrg(orgId);
  assertLibraryWrite(org, { productLine: patch.productLine });
  const item = await asInvalidInput(() => libraryRepo.update(orgId, itemId, patch));
  if (!item) throw new NotFoundError("Library item");
  await audit({
    orgId,
    actor: "user",
    type: "library.updated",
    entityType: "library_item",
    entityId: item.id,
    input: { fields: Object.keys(patch) },
  });
  return item;
}

export async function removeItem(orgId: string, itemId: string): Promise<void> {
  if (!(await libraryRepo.remove(orgId, itemId))) throw new NotFoundError("Library item");
  await audit({ orgId, actor: "user", type: "library.removed", entityType: "library_item", entityId: itemId });
}

export async function listItems(orgId: string): Promise<LibraryItem[]> {
  return libraryRepo.list(orgId);
}
