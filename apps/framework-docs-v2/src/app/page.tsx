import { redirect } from "next/navigation";

export default function HomePage() {
  // Redirect to TypeScript docs by default
  redirect("/typescript");
}
