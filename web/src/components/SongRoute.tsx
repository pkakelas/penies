import type { Metadata } from "next";
import { Suspense } from "react";
import type { Lang } from "@/lib/i18n";
import { getPublishedSong } from "@/lib/songs";
import { DraftPreview } from "./DraftPreview";
import { Footer, Header } from "./Header";
import { SongView } from "./SongView";

export type SongParams = Promise<{ slug: string }>;

export async function songMetadata(params: SongParams): Promise<Metadata> {
  const { slug } = await params;
  const song = await getPublishedSong(slug);
  if (!song) return {};
  return { title: song.artist ? `${song.title} · ${song.artist}` : song.title };
}

/** The page of one song, in either language. */
export function SongRoute({ lang, params }: { lang: Lang; params: SongParams }) {
  return (
    <Suspense fallback={<Header lang={lang} page="/" />}>
      <SongLoader lang={lang} params={params} />
    </Suspense>
  );
}

async function SongLoader({ lang, params }: { lang: Lang; params: SongParams }) {
  const { slug } = await params;
  const song = await getPublishedSong(slug);
  return (
    <>
      <Header lang={lang} page={`/songs/${slug}`} />
      {/* Not published: it may be a draft, which only a signed-in admin's browser can read. */}
      {song ? <SongView lang={lang} song={song} /> : <DraftPreview lang={lang} slug={slug} />}
      <Footer lang={lang} />
    </>
  );
}
