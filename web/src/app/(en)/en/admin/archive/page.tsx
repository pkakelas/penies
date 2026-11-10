import type { Metadata } from "next";
import { Admin } from "@/components/Admin";
import { Header } from "@/components/Header";
import { dictionaries } from "@/lib/i18n";

export const metadata: Metadata = {
  title: dictionaries.en.admin.archived,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <Header lang="en" page="/admin/archive" />
      <Admin lang="en" archive />
    </>
  );
}
