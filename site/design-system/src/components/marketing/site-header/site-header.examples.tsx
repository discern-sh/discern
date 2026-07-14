import { Button } from "../../core/button/button.tsx";
import { SiteHeader } from "./site-header.tsx";

export default function SiteHeaderExamples() {
  return (
    <SiteHeader
      brand="Northstar"
      brandMark="N"
      navItems={[
        { label: "Product", href: "#product" },
        { label: "Principles", href: "#principles" },
        { label: "Resources", href: "#resources" },
      ]}
      actions={<Button href="#start" size="sm">Get started</Button>}
      notice={
        <span>
          A new reference edition is available. <a href="#read">Read it</a>
        </span>
      }
    />
  );
}
