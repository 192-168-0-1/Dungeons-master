import { assignGatestoneSlots } from "./alt1-overlay.js?v=20260622-10";
import { partyColor, partyTextColor } from "./party-core.js?v=20260622-10";

export function buildVisibleRemoteGatestones(teamGatestones, floor, resolveSlot) {
  if (!floor || !(teamGatestones instanceof Map)) return [];
  const owners = [...teamGatestones.values()]
    .sort((left, right) => (resolveSlot(left.id, left.slot) ?? 99)
      - (resolveSlot(right.id, right.slot) ?? 99)
      || String(left.id).localeCompare(String(right.id)));
  const markers = [];
  for (const owner of owners) {
    const slot = resolveSlot(owner.id, owner.slot);
    const locations = [...owner.locations.entries()]
      .sort(([left], [right]) => Number(left) - Number(right));
    for (const [index, point] of locations) {
      markers.push({
        source: "team",
        ownerId: owner.id,
        ownerName: owner.name,
        partySlot: slot,
        point,
        text: String(index),
        fill: partyColor(slot, "#aaafb2"),
        textColor: partyTextColor(slot, "#ffffff"),
      });
    }
  }
  return assignGatestoneSlots(markers, floor);
}
