import type { Booking } from "../features/booking/types";

// Fixture de features/booking/ — ítem 75.
export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "bk1",
    organizationId: "org-1",
    branchId: "b1",
    serviceTypeId: "s1",
    resourceId: "r1",
    contactId: "c1",
    opportunityId: null,
    startsAt: "2026-09-22T12:00:00.000Z",
    endsAt: "2026-09-22T12:30:00.000Z",
    status: "CONFIRMED",
    googleEventId: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}
