import { describe, expect, it } from "vitest";

import {
  type CsvMapping,
  findDuplicateCandidates,
  type ImportRow,
  parseCsv,
  parseQif,
  READY_TO_ASSIGN,
  reservedCategoryId,
  transferDirection,
} from "../index";

const mapping: CsvMapping = {
  delimiter: ",",
  hasHeader: true,
  skipRows: 0,
  dateColumn: 0,
  dateFormat: "us",
  payeeColumn: 1,
  memoColumn: 2,
  amountColumn: 3,
  inflowColumn: null,
  outflowColumn: null,
  categoryColumn: 4,
  negate: false,
};

describe("parseCsv", () => {
  it("should read quotes, dates, amounts, and categories", () => {
    const text = `Date,Payee,Memo,Amount,Category
01/05/2026,"Shop, Inc",Lunch,"-12.34",Food
01/06/2026,Employer,Salary,"2,000.00",`;
    const result = parseCsv(text, mapping, "USD", 2);
    if (result.isErr()) throw result.error;
    expect(result.value.errors).toHaveLength(0);
    expect(result.value.rows).toHaveLength(2);
    expect(result.value.rows[0]).toMatchObject({
      date: "2026-01-05",
      amountMinor: -1234,
      payeeName: "Shop, Inc",
      categoryName: "Food",
    });
    expect(result.value.rows[1]?.amountMinor).toBe(200_000);
    expect(result.value.rows[1]?.categoryName).toBeNull();
  });

  it("should read separate inflow and outflow columns", () => {
    const text = `Date,Payee,In,Out
2026-01-05,Employer,2000.00,
2026-01-06,Shop,,12.34`;
    const result = parseCsv(
      text,
      {
        ...mapping,
        dateFormat: "iso",
        memoColumn: null,
        amountColumn: null,
        inflowColumn: 2,
        outflowColumn: 3,
        categoryColumn: null,
      },
      "USD",
      2,
    );
    if (result.isErr()) throw result.error;
    expect(result.value.rows[0]?.amountMinor).toBe(200_000);
    expect(result.value.rows[1]?.amountMinor).toBe(-1234);
  });

  it("should report a bad row without dropping the good ones", () => {
    const text = `Date,Payee,Memo,Amount,Category
01/05/2026,Shop,,nope,Food
01/06/2026,Market,,"-5.00",Food`;
    const result = parseCsv(text, mapping, "USD", 2);
    if (result.isErr()) throw result.error;
    expect(result.value.errors).toHaveLength(1);
    expect(result.value.rows).toHaveLength(1);
  });

  it("should skip leading rows before the header", () => {
    const text = `Account export
Date,Payee,Memo,Amount,Category
01/05/2026,Shop,,-12.34,Food`;
    const result = parseCsv(text, { ...mapping, skipRows: 1 }, "USD", 2);
    if (result.isErr()) throw result.error;
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.rows[0]?.payeeName).toBe("Shop");
  });
});

describe("parseQif", () => {
  it("should read records, splits, and transfers", () => {
    const text = `!Type:Bank
D1/05/2026
T-12.34
PShop
MLunch
LFood
C*
^
D1/06/2026
T-100.00
PMarket
LFood:Groceries
SFood:Groceries
EProduce
$-60.00
SHousehold
E
$-40.00
^
D1/07/2026
T-500.00
PTransfer
L[Savings]
^
`;
    const result = parseQif(text, "USD", 2, { dateFormat: "us" });
    if (result.isErr()) throw result.error;
    expect(result.value.rows).toHaveLength(3);
    expect(result.value.rows[0]).toMatchObject({
      date: "2026-01-05",
      amountMinor: -1234,
      categoryName: "Food",
      cleared: "cleared",
    });
    expect(result.value.rows[1]?.splits).toHaveLength(2);
    expect(result.value.rows[1]?.splits[0]?.amountMinor).toBe(-6000);
    expect(result.value.rows[2]).toMatchObject({
      categoryName: null,
      transferAccountName: "Savings",
    });
  });
});

describe("import edges", () => {
  it("should report an empty file instead of an empty batch", () => {
    expect(parseCsv("", mapping, "USD", 2).isErr()).toBe(true);
    expect(parseCsv("Date,Payee,Memo,Amount,Category\n", mapping, "USD", 2).isErr()).toBe(true);
    expect(parseQif("", "USD", 2, { dateFormat: "us" }).isErr()).toBe(true);
  });

  it("should name the first bad row when no row can be read", () => {
    const text = `Date,Payee,Memo,Amount,Category
not-a-date,Shop,,.,Food
01/06/2026,Market,,nope,Food`;
    const result = parseCsv(text, mapping, "USD", 2);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe("unreadable");
    expect(result.error.message).toContain("row 2");
  });

  it("should keep a separator-only amount out of the money", () => {
    const text = `Date,Payee,Memo,Amount,Category
01/05/2026,Shop,,.,Food
01/06/2026,Market,,"-5.00",Food`;
    const result = parseCsv(text, mapping, "USD", 2);
    if (result.isErr()) throw result.error;

    expect(result.value.errors).toHaveLength(1);
    expect(result.value.errors[0]?.row).toBe(2);
    expect(result.value.rows.map((row) => row.amountMinor)).toEqual([-500]);
  });

  it("should read a BOM, CRLF and a quoted line break", () => {
    const text =
      '\uFEFFDate,Payee,Memo,Amount,Category\r\n01/05/2026,Shop,"Line one\nLine two",-12.34,Food\r\n';
    const result = parseCsv(text, mapping, "USD", 2);
    if (result.isErr()) throw result.error;

    expect(result.value.rows).toHaveLength(1);
    expect(result.value.rows[0]).toMatchObject({
      payeeName: "Shop",
      memo: "Line one\nLine two",
      amountMinor: -1234,
    });
  });

  it("should map the reserved Ready to Assign name back to income", () => {
    expect(reservedCategoryId("Ready to Assign")).toBe(READY_TO_ASSIGN);
    expect(reservedCategoryId("  ready to assign ")).toBe(READY_TO_ASSIGN);
    expect(reservedCategoryId("Ready to Assign (income)")).toBeNull();
    expect(reservedCategoryId(null)).toBeNull();
  });

  it("should read a transfer's direction from the register being imported", () => {
    const outbound: ImportRow = {
      date: "2026-01-05",
      amountMinor: -5_000,
      payeeName: "Savings",
      memo: "",
      categoryName: null,
      cleared: "uncleared",
      externalId: null,
      transferAccountName: "Savings",
      splits: [],
    };
    const inbound: ImportRow = {
      ...outbound,
      amountMinor: 5_000,
      payeeName: "Checking",
      transferAccountName: "Checking",
    };

    expect(transferDirection(outbound, "Checking")).toBe("outbound");
    expect(transferDirection(inbound, "Savings")).toBe("inbound");
    expect(transferDirection(inbound, "Checking")).toBe("other-leg");
    expect(transferDirection({ ...outbound, transferAccountName: null }, "Checking")).toBeNull();
  });
});

describe("dedupe", () => {
  it("should propose a near match with the same amount", () => {
    const existing = [
      {
        id: "txn_1",
        accountId: "acct_1",
        date: "2026-01-05",
        payeeName: "Shop Inc",
        amountMinor: -1234,
        parentId: null,
      },
    ];
    const candidates = findDuplicateCandidates(
      existing as never,
      {
        date: "2026-01-06",
        amountMinor: -1234,
        payeeName: "SHOP, INC.",
        memo: "",
        categoryName: null,
        cleared: "uncleared",
        externalId: null,
        transferAccountName: null,
        splits: [],
      },
      "acct_1",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.transactionId).toBe("txn_1");
  });

  it("should ignore a different amount", () => {
    const existing = [
      {
        id: "txn_1",
        accountId: "acct_1",
        date: "2026-01-05",
        payeeName: "Shop Inc",
        amountMinor: -1200,
        parentId: null,
      },
    ];
    const candidates = findDuplicateCandidates(
      existing as never,
      {
        date: "2026-01-05",
        amountMinor: -1234,
        payeeName: "Shop Inc",
        memo: "",
        categoryName: null,
        cleared: "uncleared",
        externalId: null,
        transferAccountName: null,
        splits: [],
      },
      "acct_1",
    );
    expect(candidates).toHaveLength(0);
  });

  it("should treat a matching import id as an exact duplicate", () => {
    const existing = [
      {
        id: "txn_1",
        accountId: "acct_1",
        date: "2025-12-31",
        payeeName: "Completely Different",
        amountMinor: 999,
        parentId: null,
        imported: {
          source: "qif",
          externalId: "REF-42",
          importedAt: "2026-01-01T12:00:00.000Z",
          originalPayee: "Shop Inc",
        },
      },
    ];
    const candidates = findDuplicateCandidates(
      existing as never,
      {
        date: "2026-01-06",
        amountMinor: -1234,
        payeeName: "SHOP, INC.",
        memo: "",
        categoryName: null,
        cleared: "uncleared",
        externalId: "REF-42",
        transferAccountName: null,
        splits: [],
      },
      "acct_1",
    );
    expect(candidates).toEqual([{ transactionId: "txn_1", score: 1, reasons: ["same import id"] }]);
  });
});
