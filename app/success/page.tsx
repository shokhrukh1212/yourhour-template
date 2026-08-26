import { redirect } from "next/navigation";
export default async function SuccessRedirect({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const id = (await searchParams).r;
  redirect(id && /^[0-9a-f-]{36}$/i.test(id) ? `/?purchase=${id}` : "/");
}
