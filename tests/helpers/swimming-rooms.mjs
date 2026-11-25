export const standardId = '00000000-0000-4000-8000-000000000901';
export const familyId = '00000000-0000-4000-8000-000000000902';
export const swimmingRoomCatalog = {
  classifications: [
    { classification_id: standardId, code: 'standard', name: 'Standard Rooms', pricing_version: 1, included_capacity: 2, maximum_capacity: 2, rate_3_hours: 300, rate_12_hours: 600, extension_hourly_rate: 100 },
    { classification_id: familyId, code: 'family', name: 'Family Rooms', pricing_version: 1, included_capacity: 4, maximum_capacity: 6, rate_3_hours: 300, rate_12_hours: 900, extension_hourly_rate: 150 },
  ],
  rooms: [standardId, familyId].flatMap(classification_id => Array.from({ length: 10 }, (_, i) => ({ room_id: `${classification_id}-${i}`, classification_id, private_swimming_only: classification_id===standardId && i<2, unavailable: false, blocks: [] }))),
  services: [],
};
