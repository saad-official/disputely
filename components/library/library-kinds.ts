import type { LibraryKind } from "@/lib/db/types";

/** Labels and guidance per library kind (shared by the page and its dialogs). */
export const KIND_INFO: Record<LibraryKind, { label: string; hint: string; fills: string }> = {
  refund_policy: {
    label: "Refund policy",
    hint: "Your refund and returns terms exactly as customers see them.",
    fills: "refund_policy",
  },
  cancellation_policy: {
    label: "Cancellation policy",
    hint: "How and when a subscription can be cancelled, as shown at sign-up.",
    fills: "cancellation_policy",
  },
  disclosure: {
    label: "Disclosure",
    hint: "Where and when the customer saw a policy before paying. Say which policy (refund, cancellation or shipping) so Disputely knows what it discloses.",
    fills: "refund_policy_disclosure / cancellation_policy_disclosure",
  },
  product_description: {
    label: "Product description",
    hint: "What a product is, in your listing's words. Title it with the product name so it matches order line items.",
    fills: "product_description",
  },
  shipping_policy: {
    label: "Shipping policy",
    hint: "Carriers, dispatch times and tracking. Printed in the packet as a reference.",
    fills: "packet reference",
  },
  terms: {
    label: "Terms of sale",
    hint: "The terms the customer accepts at checkout. Printed in the packet as a reference.",
    fills: "packet reference",
  },
  other: {
    label: "Other",
    hint: "Anything else you want to keep with your policies.",
    fills: "not used by the assembler",
  },
};

export const KIND_ORDER: LibraryKind[] = [
  "refund_policy",
  "cancellation_policy",
  "disclosure",
  "product_description",
  "shipping_policy",
  "terms",
  "other",
];
