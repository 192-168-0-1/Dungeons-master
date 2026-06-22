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

export function normalizePartyName(value) {
  return String(value ?? "").toLowerCase().replace(/[_\s]+/g, "").replace(/[^a-z0-9]/g, "");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function observedPartySlot(members, name) {
  const target = normalizePartyName(name);
  if (!target) return null;
  const candidates = (members ?? [])
    .filter((member) => member?.occupied !== false && Number.isInteger(Number(member?.slot)))
    .map((member) => ({ member, key: normalizePartyName(member.name) }))
    .filter((candidate) => candidate.key);
  const exact = candidates.find((candidate) => candidate.key === target);
  if (exact) return Number(exact.member.slot);

  const limit = target.length >= 10 ? 2 : target.length >= 4 ? 1 : 0;
  if (!limit) return null;
  const ranked = candidates
    .map((candidate) => ({ ...candidate, distance: editDistance(candidate.key, target) }))
    .sort((left, right) => left.distance - right.distance);
  if (!ranked.length || ranked[0].distance > limit
    || (ranked[1] && ranked[1].distance === ranked[0].distance)) return null;
  return Number(ranked[0].member.slot);
}

export function reconcileObservedParty(scannedMembers, expectedNames) {
  const scanned = Array.isArray(scannedMembers) ? scannedMembers : [];
  const expected = (expectedNames ?? [])
    .map((name) => String(name ?? "").trim().slice(0, 24))
    .filter((name, index, values) => normalizePartyName(name)
      && values.findIndex((candidate) => normalizePartyName(candidate) === normalizePartyName(name)) === index)
    .slice(0, PARTY_SIZE);
  const usedNames = new Set();
  const matchedBySlot = new Map();

  for (const candidate of scanned) {
    const slot = Number(candidate?.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > PARTY_SIZE || candidate?.occupied !== true) continue;
    const name = expected.find((expectedName) => !usedNames.has(normalizePartyName(expectedName))
      && observedPartySlot([{ ...candidate, slot: 1 }], expectedName) === 1) ?? "";
    if (!name) continue;
    usedNames.add(normalizePartyName(name));
    matchedBySlot.set(slot, name);
  }

  const hasExpectedMatch = matchedBySlot.size > 0;
  const trustScannedOccupancy = hasExpectedMatch || expected.length === 0;
  let foundEmptyRow = false;
  return Array.from({ length: PARTY_SIZE }, (_, index) => {
    const slot = index + 1;
    const candidate = scanned.find((member) => Number(member?.slot) === slot);
    const contiguousScanned = !foundEmptyRow && candidate?.occupied === true;
    if (!contiguousScanned) foundEmptyRow = true;
    const constrainedScanned = contiguousScanned && slot <= Math.max(1, expected.length);
    const scannedOccupied = trustScannedOccupancy ? contiguousScanned : constrainedScanned;
    const fallbackOccupied = !scanned.length && slot <= Math.max(1, expected.length);
    const occupied = scannedOccupied || fallbackOccupied;
    let name = "";
    if (occupied) {
      name = matchedBySlot.get(slot) ?? "";
      if (!name && hasExpectedMatch) name = String(candidate?.name ?? "").trim().slice(0, 24);
      if (!name && !hasExpectedMatch && expected.length === 1 && slot === 1) name = expected[0];
    }
    return { slot, occupied, name, pixelCount: Number(candidate?.pixelCount) || 0 };
  });
}

export function normalizeObservedParty(value) {
  if (!Array.isArray(value)) return [];
  const slots = new Set();
  const names = new Set();
  const result = [];
  for (const candidate of value) {
    const slot = Number(candidate?.slot);
    const name = String(candidate?.name ?? "").replace(/[^a-z0-9 _-]/gi, "")
      .replace(/\s+/g, " ").trim().slice(0, 24);
    const key = normalizePartyName(name);
    if (!Number.isInteger(slot) || slot < 1 || slot > PARTY_SIZE || !key
      || slots.has(slot) || names.has(key)) continue;
    slots.add(slot);
    names.add(key);
    result.push({ slot, name, occupied: true });
  }
  return result.sort((left, right) => left.slot - right.slot);
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
