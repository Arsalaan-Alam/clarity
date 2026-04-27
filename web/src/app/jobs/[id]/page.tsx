import { JobDetail } from "./job-detail";

export default async function JobByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JobDetail id={id} />;
}
