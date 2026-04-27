import { CreateJobForm } from "./create-job-form";

export default function CreatePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Create job</h1>
      <p className="text-sm text-zinc-600">
        You are the <strong>client</strong>. Set provider and evaluator, then
        set budget and fund in order.
      </p>
      <CreateJobForm />
    </div>
  );
}
