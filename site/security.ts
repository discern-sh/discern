/**
 * The public vulnerability-disclosure coordinates. The human policy and the
 * RFC 9116 response are held to this registry by security_disclosure_test.ts.
 */

import { canonicalUrl } from "./seo.tsx";
import {
  DISCERN_ADVISORY_URL,
  DISCERN_REPOSITORY_URL,
  repositoryBlobUrl,
} from "../src/shared/brand.ts";

export const SECURITY_DISCLOSURE = {
  route: "/.well-known/security.txt",
  contactEmail: "security@discern.sh",
  repositoryUrl: DISCERN_REPOSITORY_URL,
  advisoryUrl: DISCERN_ADVISORY_URL,
  policyUrl: repositoryBlobUrl("SECURITY.md"),
  preferredLanguages: ["en"],
  expiresAt: "2027-07-31T23:59:59Z",
  expiryReviewLeadDays: 30,
  maximumValidityDays: 365,
} as const;

export interface SecurityTxtField {
  name:
    | "Canonical"
    | "Contact"
    | "Expires"
    | "Policy"
    | "Preferred-Languages";
  value: string;
}

/** Derive the ordered RFC 9116 fields from the disclosure registry. */
export function securityTxtFields(): readonly SecurityTxtField[] {
  return [
    {
      name: "Contact",
      value: `mailto:${SECURITY_DISCLOSURE.contactEmail}`,
    },
    { name: "Contact", value: SECURITY_DISCLOSURE.advisoryUrl },
    { name: "Expires", value: SECURITY_DISCLOSURE.expiresAt },
    {
      name: "Preferred-Languages",
      value: SECURITY_DISCLOSURE.preferredLanguages.join(", "),
    },
    {
      name: "Canonical",
      value: canonicalUrl(SECURITY_DISCLOSURE.route),
    },
    { name: "Policy", value: SECURITY_DISCLOSURE.policyUrl },
  ];
}

/** Render the unsigned UTF-8 security.txt body with an LF after every field. */
export function securityTxt(): string {
  return `${
    securityTxtFields().map((field) => `${field.name}: ${field.value}`).join(
      "\n",
    )
  }\n`;
}
