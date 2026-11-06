import { SongRoute, songMetadata, type SongParams } from "@/components/SongRoute";

export const generateMetadata = ({ params }: { params: SongParams }) => songMetadata(params);

export default function Page({ params }: { params: SongParams }) {
  return <SongRoute lang="en" params={params} />;
}
