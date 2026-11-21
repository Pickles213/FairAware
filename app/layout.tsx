import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "FairAware · Exam monitor",
  description: "Teacher dashboard for real-time examination station reports.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
