import { redirect } from "next/navigation";

export default function Home() {
  // Authenticated users land on the executive overview; the middleware sends
  // unauthenticated users to /signin.
  redirect("/overview");
}
