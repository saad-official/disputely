"use server";

import { revalidatePath } from "next/cache";
import { actionError, formDate, formText } from "@/app/(app)/_lib/action-errors";
import type { ActionResult, FormActionState } from "@/components/app/action-result";
import { requireOrgContext } from "@/lib/auth/session";
import { LIBRARY_KINDS } from "@/lib/db/schema";
import type { LibraryKind } from "@/lib/db/types";
import { createItem, removeItem, updateItem } from "@/lib/services/library";
import { addMessageLogs, removeMessageLog, removeShipment, saveShipment } from "@/lib/services/records";

function refresh() {
  revalidatePath("/library");
  revalidatePath("/disputes", "layout");
}

export async function saveLibraryItemAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org } = await requireOrgContext();
  const id = formText(formData, "id");
  const kind = formText(formData, "kind");
  if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Choose what kind of item this is." };
  const input = {
    kind: kind as LibraryKind,
    title: formText(formData, "title"),
    text: formText(formData, "text"),
    url: formText(formData, "url") || null,
    productLine: formText(formData, "productLine") || null,
  };
  try {
    if (id) await updateItem(org.id, id, input);
    else await createItem(org.id, input);
  } catch (error) {
    return actionError(error, "library save");
  }
  refresh();
  return { ok: true, message: id ? "Saved. Rebuild a packet to use the change." : "Added to the library." };
}

export async function deleteLibraryItemAction(id: string): Promise<ActionResult> {
  const { org } = await requireOrgContext();
  try {
    await removeItem(org.id, id);
  } catch (error) {
    return actionError(error, "library delete");
  }
  refresh();
  return { ok: true, message: "Deleted." };
}

export async function saveShipmentAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org } = await requireOrgContext();
  try {
    const { refreshed } = await saveShipment(org.id, {
      chargeId: formText(formData, "chargeId"),
      carrier: formText(formData, "carrier") || null,
      trackingNumber: formText(formData, "trackingNumber") || null,
      shippedAt: formDate(formData, "shippedAt"),
      deliveredAt: formDate(formData, "deliveredAt"),
      proofUrl: formText(formData, "proofUrl") || null,
    });
    refresh();
    return { ok: true, message: refreshed ? `Saved. ${refreshed === 1 ? "1 packet" : `${refreshed} packets`} updated.` : "Saved." };
  } catch (error) {
    return actionError(error, "shipment save");
  }
}

export async function deleteShipmentAction(id: string): Promise<ActionResult> {
  const { org } = await requireOrgContext();
  try {
    await removeShipment(org.id, id);
  } catch (error) {
    return actionError(error, "shipment delete");
  }
  refresh();
  return { ok: true };
}

export async function saveMessagesAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org } = await requireOrgContext();
  try {
    const { saved, refreshed } = await addMessageLogs(org.id, {
      customerEmail: formText(formData, "customerEmail"),
      channel: formText(formData, "channel") || "email",
      disputeId: formText(formData, "disputeId") || null,
      transcript: typeof formData.get("transcript") === "string" ? String(formData.get("transcript")) : "",
    });
    refresh();
    return {
      ok: true,
      message: `Saved ${saved.length} ${saved.length === 1 ? "message" : "messages"}${refreshed ? `; ${refreshed === 1 ? "1 packet" : `${refreshed} packets`} updated` : ""}.`,
    };
  } catch (error) {
    return actionError(error, "message logs save");
  }
}

export async function deleteMessageAction(id: string): Promise<ActionResult> {
  const { org } = await requireOrgContext();
  try {
    await removeMessageLog(org.id, id);
  } catch (error) {
    return actionError(error, "message delete");
  }
  refresh();
  return { ok: true };
}
