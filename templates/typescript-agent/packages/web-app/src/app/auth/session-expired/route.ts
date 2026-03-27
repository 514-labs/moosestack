import { NextResponse } from "next/server";
import { signOut } from "@/auth";

export async function GET(request: Request): Promise<Response> {
  try {
    await signOut({
      redirect: false,
      redirectTo: "/?session=expired",
    });
  } catch (error) {
    console.error("Failed to clear expired session", error);
  }

  return NextResponse.redirect(new URL("/?session=expired", request.url));
}
