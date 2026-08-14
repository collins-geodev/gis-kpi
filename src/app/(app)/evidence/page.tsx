import { ComingSoon } from "@/components/coming-soon";

export default function EvidencePage() {
  return (
    <ComingSoon
      title="Evidence Centre"
      description="Upload, categorize, link, version and review evidence with permission-aware, audited downloads."
      planned={[
        "Uploads for images, PDF, Office, CSV, ZIP/GIS packages, links",
        "Type/size validation, checksum, confidentiality classification",
        "Authenticated, authorized streaming (no permanent bearer URLs) — already wired server-side",
        "Review states: draft → submitted → verified → approved",
        "Search, filter and version history",
      ]}
    />
  );
}
