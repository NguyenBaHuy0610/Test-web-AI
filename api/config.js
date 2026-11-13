module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  // Cache at Vercel Edge CDN for 1 hour, stale-while-revalidate for 24 hours to prevent cold start latency
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");

  const config = {
    GROQ_API_KEY: process.env.GROQ_API_KEY || "",
    GROQ_SUPPORT_API_KEY: process.env.GROQ_SUPPORT_API_KEY || process.env.GROQ_API_KEY || "",
    GROQ_SUPPORT_MODEL: process.env.GROQ_SUPPORT_MODEL || "openai/gpt-oss-120b"
  };

  const body = `window.APP_CONFIG = ${JSON.stringify(config)};`;
  if (typeof res.status === "function") {
    if (typeof res.send === "function") {
      res.status(200).send(body);
    } else {
      res.status(200).end(body);
    }
  } else {
    res.writeHead(200);
    res.end(body);
  }
};

