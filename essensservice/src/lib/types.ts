import type { EffectiveStatus } from "./format";

export type Dashboard = {
  service_date: string;
  now: string;
  order_deadline: string;
  location_deadline: string;
  meal: { name: string; available: boolean; internal_price: number | null } | null;
  active_drivers: number;
  ordered: number;
  cancelled: number;
  drivers_without_order: number;
  missing_locations: number;
  groups: number;
  open: number;
  in_preparation: number;
  on_the_way: number;
  delivered: number;
  failed_notifications: number;
  rating_avg_30d: number | null;
  rating_count_30d: number;
  next_day_meal_missing: boolean;
};

export type DayLocation = {
  lat: number | null;
  lng: number | null;
  address: string | null;
  source: "gps" | "karte" | "adresse" | "buero";
  set_at: string;
  set_by: string;
};

export type DayOrder = {
  order_id: string;
  driver_id: string;
  driver_name: string;
  customer_hint: string | null;
  status: EffectiveStatus;
  note: string | null;
  updated_at: string;
  updated_by: string;
  location: DayLocation | null;
  group_id: string | null;
  manual: boolean;
  delivered_at: string | null;
};

export type DayGroup = {
  group_id: string;
  seq: number;
  released_at: string | null;
  courier: string | null;
  count: number;
  manual: boolean;
};

export type OfficeDay = {
  service_date: string;
  now: string;
  order_deadline: string;
  location_deadline: string;
  meal: { name: string; available: boolean } | null;
  orders: DayOrder[];
  groups: DayGroup[];
  drivers_without_order: { driver_id: string; name: string }[];
};

export type Notification = {
  id: string;
  driver_name: string;
  status: "ausstehend" | "gesendet" | "fehlgeschlagen" | "kein_abo";
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export const hasCoords = (o: DayOrder) => o.location?.lat != null && o.location?.lng != null;
