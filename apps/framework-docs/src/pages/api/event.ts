import Mixpanel from "mixpanel";
import type { NextApiRequest, NextApiResponse } from "next";

type ResponseData = {
  message: string;
};

async function mixpanelAsyncTrack(
  event: string,
  properties: object,
  mixpanel: Mixpanel.Mixpanel,
) {
  return new Promise((resolve, reject) => {
    mixpanel.track(event, properties, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve("success");
      }
    });
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>,
) {
  const body = req.body;
  const { name, ...payload } = body;
  const mixpanel = Mixpanel.init("be8ca317356e20c587297d52f93f3f9e");
  try {
    await mixpanelAsyncTrack(name, payload, mixpanel);
  } catch (error) {
    console.error(error);
  }
  res.status(200).json({ message: "Event tracked" });
}
