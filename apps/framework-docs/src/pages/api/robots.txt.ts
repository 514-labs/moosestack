import { NextApiRequest, NextApiResponse } from "next";

const athenaToken = process.env.ATHENA_TOKEN || "";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only handle GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const userAgent = req.headers["user-agent"] || "";
  const referer = req.headers["referer"] || "";
  let robotsContent = "";

  try {
    // Inform AthenaHQ about the request
    await fetch("https://app.athenahq.ai/api/robots", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${athenaToken}`,
      },
      body: JSON.stringify({
        userAgent,
        referer,
        path: "/robots.txt",
      }),
    });

    // Fetch the actual robots.txt content
    const response = await fetch(
      `https://app.athenahq.ai/api/robots-txt/${athenaToken}`,
    );

    if (response.ok) {
      robotsContent = await response.text();
    } else {
      console.error(
        "Error fetching robots.txt from AthenaHQ:",
        response.status,
        await response.text(),
      );
      robotsContent = `User-agent: *
Allow: /`;
    }
  } catch (e) {
    console.error("Error in robots.txt API handler:", e);
    robotsContent = `User-agent: *
Allow: /`;
  }

  // Set the content type to text/plain for robots.txt
  res.setHeader("Content-Type", "text/plain");

  // Optional: Add caching headers
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");

  return res.status(200).send(robotsContent);
}
