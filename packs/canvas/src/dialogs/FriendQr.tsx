import { qrMatrix } from "@suite/sync";

/**
 * A friend link as a QR, drawn from the same matrix the relay console uses.
 *
 * `@suite/sync` already owns QR rendering, so this adds no dependency: it turns the
 * matrix into one `<path>` rather than a canvas or an image. The payload is the link
 * the dialog also shows as text, so a scan and a paste add the same contact.
 */
export function FriendQr({ payload }: { readonly payload: string }) {
  let matrix: ReturnType<typeof qrMatrix>;
  try {
    matrix = qrMatrix(payload);
  } catch {
    // An incomplete link is not a broken dialog: the code text is still there to copy.
    return null;
  }

  const border = 4;
  const dimension = matrix.size + border * 2;
  let path = "";
  matrix.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "1") path += `M${x + border} ${y + border}h1v1h-1z`;
    }
  });

  return (
    <svg
      role="img"
      aria-label="Friend link QR code"
      data-testid="friend-qr"
      data-payload={payload}
      viewBox={`0 0 ${dimension} ${dimension}`}
      shapeRendering="crispEdges"
      className="h-24 w-24 shrink-0 rounded-sm bg-white p-1"
    >
      <rect width={dimension} height={dimension} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
