import { describe, expect, it } from "vitest";
import { convexHull, distanceM, maxPairwiseM } from "@/lib/geo";
import pg from "pg";

describe("Geometrie", () => {
  it("rechnet Abstände wie die Datenbank", async () => {
    const a = { lat: 53.43, lng: 12.7 };
    const b = { lat: 53.4345, lng: 12.7061 };
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/essen_test" });
    await c.connect();
    const { rows } = await c.query("select public.distance_m($1, $2, $3, $4) as d", [a.lat, a.lng, b.lat, b.lng]);
    await c.end();
    expect(distanceM(a, b)).toBeCloseTo(Number(rows[0].d), 6);
  });

  it("kennt die Größenordnung (0,001° Breite ≈ 111 m)", () => {
    expect(distanceM({ lat: 53, lng: 12 }, { lat: 53.001, lng: 12 })).toBeCloseTo(111.2, 0);
  });

  it("bestimmt den größten paarweisen Abstand und die Hülle", () => {
    const pts = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 0.002 }, { lat: 0.002, lng: 0.002 }, { lat: 0.002, lng: 0 }, { lat: 0.001, lng: 0.001 },
    ];
    expect(convexHull(pts)).toHaveLength(4);
    expect(maxPairwiseM(pts)).toBeCloseTo(distanceM(pts[0], pts[2]), 6);
    expect(maxPairwiseM([pts[0]])).toBe(0);
  });
});
