import type { Metadata } from "next";
import { Footer, Header } from "@/components/Header";
import { Orders } from "@/components/Orders";
import { dictionaries } from "@/lib/i18n";

export const metadata: Metadata = {
  title: dictionaries.el.orders.title,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <Header lang="el" page="/orders" />
      <Orders lang="el" />
      <Footer lang="el" />
    </>
  );
}
