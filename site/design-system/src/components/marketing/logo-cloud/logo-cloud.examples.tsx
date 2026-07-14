import { LogoCloud } from "./logo-cloud.tsx";

export default function LogoCloudExamples() {
  return (
    <LogoCloud
      label="Trusted by teams doing careful work"
      items={[
        { name: "Northstar", mark: "◇" },
        { name: "Fieldwork", mark: "✦" },
        { name: "Commonroom", mark: "○" },
        { name: "Atlas", mark: "△" },
      ]}
    />
  );
}
