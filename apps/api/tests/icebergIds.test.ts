/**
 * `parseIcebergBody`: a catalog answer is parsed with every snapshot id exact.
 * A 64-bit id above 2^53 cannot survive as a JSON number, so the three id keys
 * come back as strings and everything else stays a number.
 */
import { describe, expect, it } from "vitest";
import { parseIcebergBody } from "../infrastructure/database/lake/connection";

const BODY = `{
  "metadata-location": "s3://lakehouse/x/metadata/00533.metadata.json",
  "metadata": {
    "current-snapshot-id": 7470822850192638789,
    "last-updated-ms": 1789764992567,
    "snapshots": [
      { "snapshot-id" : 7770091086029777012, "sequence-number": 532, "timestamp-ms": 1789764990000 },
      { "snapshot-id": 7470822850192638789, "parent-snapshot-id": 7770091086029777012,
        "sequence-number": 533, "timestamp-ms": 1789764992567,
        "summary": { "total-records": "882665821" } }
    ],
    "snapshot-log": [ { "snapshot-id": 7470822850192638789, "timestamp-ms": 1789764992567 } ]
  }
}`;

describe("parseIcebergBody", () => {
  it("keeps every digit of a snapshot id above 2^53", () => {
    const metadata = parseIcebergBody(BODY).metadata as Record<string, unknown>;
    const snapshots = metadata.snapshots as Array<Record<string, unknown>>;
    expect(metadata["current-snapshot-id"]).toBe("7470822850192638789");
    expect(snapshots[0]!["snapshot-id"]).toBe("7770091086029777012");
    expect(snapshots[1]!["snapshot-id"]).toBe("7470822850192638789");
    expect(snapshots[1]!["parent-snapshot-id"]).toBe("7770091086029777012");
  });

  it("leaves timestamps, sequence numbers and summaries as they were", () => {
    const metadata = parseIcebergBody(BODY).metadata as Record<string, unknown>;
    const newest = (metadata.snapshots as Array<Record<string, unknown>>)[1]!;
    expect(metadata["last-updated-ms"]).toBe(1789764992567);
    expect(newest["sequence-number"]).toBe(533);
    expect(newest["timestamp-ms"]).toBe(1789764992567);
    expect((newest.summary as Record<string, string>)["total-records"]).toBe("882665821");
  });

  it("reads a table with no snapshot yet", () => {
    const metadata = parseIcebergBody('{"metadata":{"current-snapshot-id":-1,"snapshots":[]}}').metadata as Record<string, unknown>;
    expect(metadata["current-snapshot-id"]).toBe("-1");
  });
});
