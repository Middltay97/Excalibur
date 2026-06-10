// Field Teams — kept ONLY as a lookup table for badge colors and labels in
// filter chips. The portal switcher (see src/contexts/portal-context.tsx)
// owns app-wide theming; this module no longer drives CSS variables.

import redSigmaEmblem from "@/assets/portals/red-sigma.png";
import orangeNovaEmblem from "@/assets/portals/orange-nova.png";
import yellowMagnaEmblem from "@/assets/portals/yellow-magna.png";
import greenGammaEmblem from "@/assets/portals/green-gamma.png";
import blueThetaEmblem from "@/assets/portals/blue-theta.png";
import purpleDeltaEmblem from "@/assets/portals/purple-delta.png";
import blackVectraEmblem from "@/assets/portals/black-vectra.png";

export type TeamId =
  | "red-sigma"
  | "orange-nova"
  | "yellow-magna"
  | "green-gamma"
  | "blue-theta"
  | "purple-delta"
  | "black-vectra";

export interface Team {
  id: TeamId;
  label: string;
  color: string; // hex used for color dots/badge accents
  emblem: string;
}

export const TEAMS: Team[] = [
  { id: "red-sigma", label: "Red-Sigma", color: "#A4005A", emblem: redSigmaEmblem },
  { id: "orange-nova", label: "Orange-Nova", color: "#D03B00", emblem: orangeNovaEmblem },
  { id: "yellow-magna", label: "Yellow-Magna", color: "#AC7B00", emblem: yellowMagnaEmblem },
  { id: "green-gamma", label: "Green-Gamma", color: "#008266", emblem: greenGammaEmblem },
  { id: "blue-theta", label: "Blue-Theta", color: "#2F60C3", emblem: blueThetaEmblem },
  { id: "purple-delta", label: "Purple-Delta", color: "#5A4999", emblem: purpleDeltaEmblem },
  { id: "black-vectra", label: "Black-Vectra", color: "#373155", emblem: blackVectraEmblem },
];

export function getTeam(id: string | null | undefined): Team | null {
  if (!id) return null;
  return TEAMS.find((t) => t.id === id) ?? null;
}
