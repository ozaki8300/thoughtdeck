import ThoughtDeckIsland from "./ThoughtDeckIsland";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;

  return (
    <ThoughtDeckIsland
      searchParams={resolvedSearchParams}
    />
  );
}
