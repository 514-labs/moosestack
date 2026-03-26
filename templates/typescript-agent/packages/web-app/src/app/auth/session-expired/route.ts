import { NextResponse } from "next/server";
import { signOut } from "@/auth";

export async function GET(request: Request) {
  await signOut({
    redirect: false,
    redirectTo: "/?session=expired",
  });

  return NextResponse.redirect(new URL("/?session=expired", request.url));
}
