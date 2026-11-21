// Old hosted URLs are retired. Do not read or forward report bodies here.
export function POST() {
  return Response.json(
    {
      error:
        "This report URL has closed. Send JSON to the teacher PC using the current exam URL from Connection.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
