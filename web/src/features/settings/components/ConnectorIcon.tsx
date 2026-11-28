import { PlugZap } from "@jeff/icons";

type Kind = "atlassian" | "jira" | "bitbucket" | "github" | "chrome" | "gitlab" | "figma" | "google" | "mcp";

function kindOf(name: string): Kind {
  const value = name.toLowerCase();
  if (value.includes("atlassian")) return "atlassian";
  if (value.includes("jira") || value.includes("confluence")) return "jira";
  if (value.includes("bitbucket")) return "bitbucket";
  if (value.includes("github")) return "github";
  if (value.includes("chrome") || value.includes("devtools")) return "chrome";
  if (value.includes("gitlab")) return "gitlab";
  if (value.includes("figma")) return "figma";
  if (value.includes("google") || value.includes("gmail") || value.includes("calendar") || value.includes("drive")) return "google";
  return "mcp";
}

const ASSET: Partial<Record<Kind, string>> = {
  chrome: "chrome.svg",
  gitlab: "gitlab.svg",
  figma: "figma.svg",
  google: "google.svg",
};

/** Brand marks for every connector and known MCP server. */
export default function ConnectorIcon({ name, size = 22 }: { name: string; size?: number }) {
  const kind = kindOf(name);
  const asset = ASSET[kind];
  if (asset) {
    return <img src={`${import.meta.env.BASE_URL}material-icons/${asset}`} alt="" width={size} height={size} />;
  }
  if (kind === "github") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
        <path d="M12 .7a11.3 11.3 0 0 0-3.57 22.03c.57.1.78-.25.78-.55v-2.1c-3.18.69-3.85-1.35-3.85-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.95.1-.74.4-1.25.72-1.54-2.54-.29-5.21-1.27-5.21-5.65 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.17a10.9 10.9 0 0 1 5.72 0c2.18-1.48 3.14-1.17 3.14-1.17.62 1.57.23 2.73.11 3.02.73.8 1.18 1.82 1.18 3.07 0 4.39-2.68 5.36-5.23 5.64.41.35.78 1.04.78 2.1v3.11c0 .3.21.66.79.55A11.3 11.3 0 0 0 12 .7Z" />
      </svg>
    );
  }
  if (kind === "jira") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#2684FF" />
        <path d="M12 4.5 19 11.5l-3.2 3.2L12 10.9l-3.8 3.8L5 11.5 12 4.5Z" fill="#fff" />
        <path d="m12 13.4 3.8 3.8L12 21l-3.8-3.8 3.8-3.8Z" fill="#fff" opacity=".7" />
      </svg>
    );
  }
  if (kind === "bitbucket") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#0052CC" />
        <path d="M6 6h12l-1.8 12H7.8L6 6Zm3.2 3.4.5 4.2h4.6l.5-4.2H9.2Z" fill="#fff" />
      </svg>
    );
  }
  if (kind === "atlassian") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#0052CC" />
        <path d="M12.1 4.2c-.5 0-.9.3-1.1.8L6.6 15.3c-.2.4.1.9.6.9h4.6c.5 0 .9-.3 1.1-.8l1.4-3.5c.2-.5.7-.8 1.2-.8h3.4L12.1 4.2Z" fill="#fff" />
        <path d="M9.1 15.3c-.4 0-.7.2-.9.6l-1.5 3.2c-.2.4.1.9.6.9h5.6c.3 0 .5-.2.6-.5l1.1-2.7c.2-.4-.1-.9-.6-.9H9.1Z" fill="#fff" opacity=".7" />
      </svg>
    );
  }
  return <PlugZap size={size} />;
}
