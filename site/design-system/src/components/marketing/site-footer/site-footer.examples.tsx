import { SiteFooter } from "./site-footer.tsx";

export default function SiteFooterExamples() {
  return (
    <SiteFooter
      brand="Northstar"
      brandMark="N"
      description={
        <p>A small system for teams doing consequential work with care.</p>
      }
      groups={[
        {
          title: "Product",
          links: [
            { label: "Overview", href: "#overview" },
            { label: "Examples", href: "#examples" },
            { label: "Pricing", href: "#pricing" },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "Documentation", href: "#docs" },
            { label: "Guides", href: "#guides" },
            { label: "Changelog", href: "#changes" },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "#about" },
            { label: "Careers", href: "#careers" },
            { label: "Contact", href: "#contact" },
          ],
        },
      ]}
      legal="© 2026 Northstar"
      meta="Built carefully · served simply"
    />
  );
}
