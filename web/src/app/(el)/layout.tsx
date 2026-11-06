import type { Metadata } from "next";
import { RootShell } from "@/components/RootShell";
import { dictionaries, SITE_NAME } from "@/lib/i18n";

const t = dictionaries.el;

export const metadata: Metadata = {
  title: { default: t.meta.title, template: `%s — ${SITE_NAME.el}` },
  description: t.meta.description,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RootShell lang="el">{children}</RootShell>;
}
