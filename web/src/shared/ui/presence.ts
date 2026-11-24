export type MemberStatus = "online" | "working" | "away" | "busy" | "offline";

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  online: "Online",
  working: "Trabalhando",
  away: "Ausente",
  busy: "Não perturbe",
  offline: "Offline",
};
