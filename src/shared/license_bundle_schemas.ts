/** Runtime schemas for the compressed legal bundles embedded in the binary. */

import { z } from "@zod/zod";
import { FIRST_PARTY_LEGAL_DOCUMENT_KINDS } from "./license_registry.ts";

/** One first-party legal document plus its exact embedded source text. */
export const firstPartyLegalDocumentSchema = z.object({
  key: z.string(),
  kind: z.enum(FIRST_PARTY_LEGAL_DOCUMENT_KINDS),
  identifier: z.string(),
  title: z.string(),
  path: z.string(),
  smokeMarker: z.string(),
  text: z.string(),
});

/** The compressed first-party legal-document payload. */
export const firstPartyLicenseBundleSchema = z.object({
  documents: z.array(firstPartyLegalDocumentSchema).readonly(),
});

/** One credited component in the compressed third-party notices payload. */
export const thirdPartyComponentSchema = z.object({
  name: z.string(),
  version: z.string(),
  registry: z.string(),
  license: z.string(),
});

/** The compressed third-party notices payload. */
export const thirdPartyLicenseBundleSchema = z.object({
  notices: z.string(),
  components: z.array(thirdPartyComponentSchema).readonly(),
});

/** One validated embedded first-party document. */
export type FirstPartyLegalDocument = z.output<
  typeof firstPartyLegalDocumentSchema
>;
/** One validated embedded first-party bundle. */
export type FirstPartyLicenseBundle = z.output<
  typeof firstPartyLicenseBundleSchema
>;
/** One validated embedded third-party bundle. */
export type ThirdPartyLicenseBundle = z.output<
  typeof thirdPartyLicenseBundleSchema
>;
