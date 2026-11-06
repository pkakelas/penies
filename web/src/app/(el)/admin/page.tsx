import type { Metadata } from "next";
import { Admin } from "@/components/Admin";
import { Header } from "@/components/Header";
import { dictionaries } from "@/lib/i18n";

export const metadata: Metadata = {
  title: dictionaries.el.admin.title,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <Header lang="el" page="/admin" />
      <Admin lang="el" />
    </>
  );
}
