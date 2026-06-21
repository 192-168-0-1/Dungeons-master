export const PARTY_SIZE = 5;

export const PARTY_COLORS = Object.freeze([
  Object.freeze({ slot: 1, name: "Red", color: "#e7502b", textColor: "#ffffff" }),
  Object.freeze({ slot: 2, name: "Cyan", color: "#35b7e8", textColor: "#071316" }),
  Object.freeze({ slot: 3, name: "Green", color: "#52be4c", textColor: "#071307" }),
  Object.freeze({ slot: 4, name: "Yellow", color: "#eed340", textColor: "#171303" }),
  Object.freeze({ slot: 5, name: "Grey", color: "#aaafb2", textColor: "#101314" }),
]);

function cleanId(value) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
}

function cleanMemberName(value) {
  return String(value ?? "").trim().slice(0, 24) || "Team mate";
}

export function partyStyle(slot) {
  const number = Number(slot);
  return PARTY_COLORS.find((entry) => entry.slot === number) ?? null;
}

export function partyColor(slot, fallback = "#ffd23f") {
  return partyStyle(slot)?.color ?? fallback;
}

export function partyTextColor(slot, fallback = "#111111") {
  return partyStyle(slot)?.textColor ?? fallback;
}

export function normalizePartyRoster(value) {
  if (!Array.isArray(value)) return [];
  const members = [];
  const ids = new Set();
  const slots = new Set();
  for (const candidate of value) {
    const id = cleanId(candidate?.id);
    const slot = Number(candidate?.slot);
    if (!id || !Number.isInteger(slot) || slot < 1 || slot > PARTY_SIZE
      || ids.has(id) || slots.has(slot)) continue;
    ids.add(id);
    slots.add(slot);
    members.push({ id, name: cleanMemberName(candidate?.name), slot });
  }
  return members.sort((left, right) => left.slot - right.slot);
}

export function addPartyMember(roster, candidate) {
  const members = normalizePartyRoster(roster);
  const id = cleanId(candidate?.id);
  if (!id) return { roster: members, member: null, full: false };

  const existing = members.find((member) => member.id === id);
  if (existing) {
    existing.name = cleanMemberName(candidate?.name);
    return { roster: members, member: { ...existing }, full: false };
  }

  const used = new Set(members.map((member) => member.slot));
  const slot = Array.from({ length: PARTY_SIZE }, (_, index) => index + 1)
    .find((number) => !used.has(number));
  if (!slot) return { roster: members, member: null, full: true };

  const member = { id, name: cleanMemberName(candidate?.name), slot };
  return {
    roster: normalizePartyRoster([...members, member]),
    member,
    full: false,
  };
}

export function removePartyMember(roster, id, compact = true) {
  const remaining = normalizePartyRoster(roster).filter((member) => member.id !== cleanId(id));
  if (!compact) return remaining;
  return remaining.map((member, index) => ({ ...member, slot: index + 1 }));
}

export function parsePartyRoster(value) {
  try {
    return normalizePartyRoster(JSON.parse(String(value ?? "")));
  } catch {
    return [];
  }
}
