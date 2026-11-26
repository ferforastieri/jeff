import type { ReactNode } from "react";
import { Avatar, type PersonRecipe } from "faang-ui";
import type { Principal } from "../rooms/api";
import { PersonFace } from "../onboarding/PersonFace";

export const AGENT_FACE = `${import.meta.env.BASE_URL}jeffs/jeff-01-blue.png`;
export const WORKSPACE_FACE = `${import.meta.env.BASE_URL}brand/jeff-mark.png`;

/** The face of a person or agent: photo, pixel portrait, the Jeff mark or initials. */
export function faceOf(principal: Principal | null | undefined, size = 36): ReactNode {
  const avatar = principal?.avatar as
    | { kind?: string; url?: string; recipe?: PersonRecipe }
    | undefined;
  if (avatar?.kind === "photo" && avatar.url) {
    return (
      <Avatar
        kind="person"
        name={principal?.name ?? ""}
        size={size >= 56 ? "lg" : size >= 32 ? "md" : "sm"}
        imageUrl={avatar.url}
      />
    );
  }
  if (avatar?.kind === "person" && avatar.recipe) {
    return (
      <span className="ws-face" style={{ width: size, height: size }}>
        <PersonFace recipe={avatar.recipe} crop="face" />
      </span>
    );
  }
  if (principal?.kind === "bot") {
    return (
      <span className="ws-face ws-face--agent" style={{ width: size, height: size }}>
        <img src={AGENT_FACE} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <Avatar
      kind="person"
      name={principal?.name ?? "?"}
      size={size >= 56 ? "lg" : size >= 32 ? "md" : "sm"}
    />
  );
}

/** The other people in a direct conversation, by name. */
export function personName(room: { members: Principal[] }, me: Principal | null): string {
  return room.members
    .filter((member) => member.id !== me?.id && member.kind === "human")
    .map((member) => member.name)
    .join(", ");
}
