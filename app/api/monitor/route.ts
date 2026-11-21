function localReceiver() {
  return Response.json(
    { error: "Connect the dashboard to the receiver on the teacher PC." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export { localReceiver as GET, localReceiver as POST };
