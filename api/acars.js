import { getAcarsMessages } from "../lib/airframes.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, max-age=10, stale-while-revalidate=10");

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const data = await getAcarsMessages({
      flight: req.query?.flight,
      limit: req.query?.limit
    });
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
      ok: false,
      error: error.message || "ACARS provider unavailable"
    });
  }
}
